import { PathConfig, PathConfigMap, validatePathConfig } from '@react-navigation/native';
import type { NavigationState, PartialState, Route } from '@react-navigation/routers';
import * as queryString from 'query-string';

import {
  matchDeepDynamicRouteName,
  matchDynamicName,
  matchGroupName,
  testNotFound,
} from '../matchers';

type Options<ParamList extends object> = {
  path?: string;
  initialRouteName?: string;
  screens: PathConfigMap<ParamList>;

  // Start fork
  preserveDynamicRoutes?: boolean;
  preserveGroups?: boolean;
  // End fork
};

export type State = NavigationState | Omit<PartialState<NavigationState>, 'stale'>;

type StringifyConfig = Record<string, (value: any) => string>;

type ConfigItem = {
  pattern?: string;
  stringify?: StringifyConfig;
  screens?: Record<string, ConfigItem>;

  // Start Fork
  // Used as fallback for groups
  initialRouteName?: string;
  // End Fork
};

const getActiveRoute = (state: State): { name: string; params?: object } => {
  const route =
    typeof state.index === 'number'
      ? state.routes[state.index]
      : state.routes[state.routes.length - 1];

  if (route.state) {
    return getActiveRoute(route.state);
  }

  return route;
};

/**
 * Utility to serialize a navigation state object to a path string.
 *
 * @example
 * ```js
 * getPathFromState(
 *   {
 *     routes: [
 *       {
 *         name: 'Chat',
 *         params: { author: 'Jane', id: 42 },
 *       },
 *     ],
 *   },
 *   {
 *     screens: {
 *       Chat: {
 *         path: 'chat/:author/:id',
 *         stringify: { author: author => author.toLowerCase() }
 *       }
 *     }
 *   }
 * )
 * ```
 *
 * @param state Navigation state to serialize.
 * @param options Extra options to fine-tune how to serialize the path.
 * @returns Path representing the state, e.g. /foo/bar?count=42.
 */
export function getPathFromState<ParamList extends object>(
  state: State,
  options?: Options<ParamList>
): string {
  return getPathDataFromState(state, options).path;
}

export function getPathDataFromState<ParamList extends object>(
  state: State,
  { preserveDynamicRoutes, preserveGroups, ...options }: Options<ParamList> = { screens: {} }
) {
  if (state == null) {
    throw Error("Got 'undefined' for the navigation state. You must pass a valid state object.");
  }

  if (options) {
    validatePathConfig(options);
  }

  // Create a normalized configs object which will be easier to use
  const configs: Record<string, ConfigItem> = options?.screens
    ? createNormalizedConfigs(options?.screens)
    : {};

  let path = '/';
  let current: State | undefined = state;

  const allParams: Record<string, any> = {};

  while (current) {
    let index = typeof current.index === 'number' ? current.index : 0;
    let route = current.routes[index] as Route<string> & {
      state?: State;
    };

    let pattern: string | undefined;

    let focusedParams: Record<string, any> | undefined;
    const focusedRoute = getActiveRoute(state);
    let currentOptions = configs;

    // Keep all the route names that appeared during going deeper in config in case the pattern is resolved to undefined
    const nestedRouteNames: string[] = [];

    let hasNext = true;

    while (route.name in currentOptions && hasNext) {
      pattern = currentOptions[route.name].pattern;

      nestedRouteNames.push(route.name);

      if (route.params) {
        const stringify = currentOptions[route.name]?.stringify;

        const currentParams = Object.fromEntries(
          // Start fork - better handle array params
          // Object.entries(route.params).map(([key, value]) => [
          //   key,
          //   stringify?.[key] ? stringify[key](value) : String(value),
          // ])
          Object.entries(route.params!).map(([key, value]) => [
            key,
            stringify?.[key]
              ? stringify[key](value)
              : Array.isArray(value)
                ? value.map(String)
                : String(value),
          ])
          // End Fork
        );

        // Start Fork - We always assign params, as non pattern routes may still have query params
        // if (pattern) {
        //   Object.assign(allParams, currentParams);
        // }
        Object.assign(allParams, currentParams);
        // End Fork

        if (focusedRoute === route) {
          // If this is the focused route, keep the params for later use
          // We save it here since it's been stringified already
          focusedParams = { ...currentParams };

          pattern
            ?.split('/')
            .filter((p) => p.startsWith(':'))
            // eslint-disable-next-line no-loop-func
            .forEach((p) => {
              const name = getParamName(p);

              // Remove the params present in the pattern since we'll only use the rest for query string
              if (focusedParams) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete focusedParams[name];
              }
            });
        }
      }

      // If there is no `screens` property or no nested state, we return pattern
      if (!currentOptions[route.name].screens || route.state === undefined) {
        hasNext = false;
      } else {
        index =
          typeof route.state.index === 'number' ? route.state.index : route.state.routes.length - 1;

        const nextRoute = route.state.routes[index];
        const nestedConfig = currentOptions[route.name].screens;

        // if there is config for next route name, we go deeper
        if (nestedConfig && nextRoute.name in nestedConfig) {
          route = nextRoute as Route<string> & { state?: State };
          currentOptions = nestedConfig;
        } else {
          // If not, there is no sense in going deeper in config
          hasNext = false;
        }
      }
    }

    if (pattern === undefined) {
      pattern = nestedRouteNames.join('/');
    }

    if (currentOptions[route.name] !== undefined) {
      path += pattern
        .split('/')
        .map((p, index, segments) => {
          const name = getParamName(p);

          // Start Fork
          if (preserveDynamicRoutes) {
            if (p.startsWith(':')) {
              return `[${getParamName(p)}]`;
            } else if (p.startsWith('*')) {
              if (name === 'not-found') {
                return name;
              }
              return `[...${getParamName(p)}]`;
            } else if (p.startsWith('*')) {
              return matchDeepDynamicRouteName(p) ?? p;
            }
          }
          // End Fork

          // We don't know what to show for wildcard patterns
          // Showing the route name seems ok, though whatever we show here will be incorrect
          // Since the page doesn't actually exist
          if (p === '*') {
            return route.name;
          }

          // If the path has a pattern for a param, put the param in the path
          if (p.startsWith(':') || p.startsWith('*')) {
            const value = allParams[name];

            if (value === undefined && p.endsWith('?')) {
              // Optional params without value assigned in route.params should be ignored
              return '';
            }

            // Valid characters according to
            // https://datatracker.ietf.org/doc/html/rfc3986#section-3.3 (see pchar definition)
            return String(value).replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]/g, (char) =>
              encodeURIComponent(char)
            );
          }

          if (!preserveGroups && matchGroupName(p) != null) {
            // When the last part is a group it could be a shared URL
            // if the route has an initialRouteName defined, then we should
            // use that as the component path as we can assume it will be shown.
            if (segments.length - 1 === index) {
              const initialRouteName = configs[route.name]?.initialRouteName;
              if (initialRouteName) {
                // Return an empty string if the init route is ambiguous.
                if (segmentMatchesConvention(initialRouteName)) {
                  return '';
                }
                return encodeURIComponentPreservingBrackets(initialRouteName);
              }
            }
            return '';
          }

          // Start Fork
          // return encodeURIComponent(p);
          return encodeURIComponentPreservingBrackets(p);
          // End Fork
        })
        .join('/');
    } else {
      path += encodeURIComponent(route.name);
    }

    if (!focusedParams) {
      focusedParams = focusedRoute.params;
    }

    if (route.state) {
      path += '/';
    } else if (focusedParams) {
      for (const param in focusedParams) {
        if (focusedParams[param] === 'undefined') {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete focusedParams[param];
        }
      }

      // Start Fork
      // const query = queryString.stringify(focusedParams, { sort: false });
      const { '#': hash, ...focusedParamsWithoutHash } = focusedParams;
      const query = queryString.stringify(focusedParamsWithoutHash, { sort: false });
      // End Fork

      if (query) {
        path += `?${query}`;
      }
    }

    current = route.state;
  }

  // Remove multiple as well as trailing slashes
  path = path.replace(/\/+/g, '/');
  path = path.length > 1 ? path.replace(/\/$/, '') : path;

  // Include the root path if specified
  if (options?.path) {
    path = joinPaths(options.path, path);
  }

  if (allParams['#']) {
    path += `#${allParams['#']}`;
  }

  path = appendBaseUrl(path);

  return { path, params: allParams };
}

export function decodeParams(params: Record<string, string>) {
  const parsed: Record<string, any> = {};

  for (const [key, value] of Object.entries(params)) {
    try {
      if (key === 'params' && typeof value === 'object') {
        parsed[key] = decodeParams(value);
      } else if (Array.isArray(value)) {
        parsed[key] = value.map((v) => decodeURIComponent(v));
      } else {
        parsed[key] = decodeURIComponent(value);
      }
    } catch {
      parsed[key] = value;
    }
  }

  return parsed;
}

// START FORK
// const getParamName = (pattern: string) => pattern.replace(/^:/, '').replace(/\?$/, '');
const getParamName = (pattern: string) => pattern.replace(/^[:*]/, '').replace(/\?$/, '');
// END FORK

const joinPaths = (...paths: string[]): string =>
  ([] as string[])
    .concat(...paths.map((p) => p.split('/')))
    .filter(Boolean)
    .join('/');

const createConfigItem = (
  config: PathConfig<object> | string,
  parentPattern?: string
): ConfigItem => {
  if (typeof config === 'string') {
    // If a string is specified as the value of the key(e.g. Foo: '/path'), use it as the pattern
    const pattern = parentPattern ? joinPaths(parentPattern, config) : config;

    return { pattern };
  }

  if (config.exact && config.path === undefined) {
    throw new Error(
      "A 'path' needs to be specified when specifying 'exact: true'. If you don't want this screen in the URL, specify it as empty string, e.g. `path: ''`."
    );
  }

  // If an object is specified as the value (e.g. Foo: { ... }),
  // It can have `path` property and `screens` prop which has nested configs
  const pattern =
    config.exact !== true ? joinPaths(parentPattern || '', config.path || '') : config.path || '';

  const screens = config.screens ? createNormalizedConfigs(config.screens, pattern) : undefined;

  return {
    // Normalize pattern to remove any leading, trailing slashes, duplicate slashes etc.
    pattern: pattern?.split('/').filter(Boolean).join('/'),
    stringify: config.stringify,
    screens,
  };
};

const createNormalizedConfigs = (
  options: PathConfigMap<object>,
  pattern?: string
): Record<string, ConfigItem> =>
  Object.fromEntries(
    Object.entries(options).map(([name, c]) => {
      const result = createConfigItem(c, pattern);

      return [name, result];
    })
  );

export function appendBaseUrl(
  path: string,
  baseUrl: string | undefined = process.env.EXPO_BASE_URL
) {
  if (process.env.NODE_ENV !== 'development') {
    if (baseUrl) {
      return `/${baseUrl.replace(/^\/+/, '').replace(/\/$/, '')}${path}`;
    }
  }
  return path;
}

function segmentMatchesConvention(segment: string): boolean {
  return (
    segment === 'index' ||
    matchDynamicName(segment) != null ||
    matchGroupName(segment) != null ||
    matchDeepDynamicRouteName(segment) != null
  );
}

function encodeURIComponentPreservingBrackets(str: string) {
  return encodeURIComponent(str).replace(/%5B/g, '[').replace(/%5D/g, ']');
}

/** Given a set of query params and a pattern with possible conventions, collapse the conventions and return the remaining params. */
function getParamsWithConventionsCollapsed(
  pattern: string,
  routeName: string,
  params: Record<string, string>
): Record<string, string> {
  const processedParams = { ...params };

  // Remove the params present in the pattern since we'll only use the rest for query string

  const segments = pattern.split('/');

  // Dynamic Routes
  segments
    .filter((segment) => segment.startsWith(':'))
    .forEach((segment) => {
      const name = getParamName(segment);
      delete processedParams[name];
    });

  // Deep Dynamic Routes
  if (segments.some((segment) => segment.startsWith('*'))) {
    // NOTE(EvanBacon): Drop the param name matching the wildcard route name -- this is specific to Expo Router.
    const name = testNotFound(routeName)
      ? 'not-found'
      : matchDeepDynamicRouteName(routeName) ?? routeName;
    delete processedParams[name];
  }

  return processedParams;
}
