import { PathConfigMap, validatePathConfig } from '@react-navigation/native';
import type { InitialState, NavigationState, PartialState } from '@react-navigation/routers';
import escape from 'escape-string-regexp';

import { findFocusedRoute } from './findFocusedRoute';
import * as forks from './getStateFromPath-forks';
import { RouterStore } from '../global-state/router-store';
import { matchGroupName, stripGroupSegmentsFromPath } from '../matchers';

type Options<ParamList extends object> = {
  path?: string;
  initialRouteName?: string;
  screens: PathConfigMap<ParamList>;

  // Start Fork
  allowUrlParamNormalization?: boolean;
  // End Fork
};

type ParseConfig = Record<string, (value: string) => any>;

type RouteConfig = {
  screen: string;
  regex?: RegExp;
  path: string;
  pattern: string;
  routeNames: string[];
  parse?: ParseConfig;

  // Start fork
  expandedRouteNames: string[];
  userReadableName: string;
  hasChildren: boolean;
  _route: any;
  // End fork
};

type InitialRouteConfig = {
  initialRouteName: string;
  parentScreens: string[];
};

export type ResultState = PartialState<NavigationState> & {
  state?: ResultState;
};

export type ParsedRoute = {
  name: string;
  path?: string;
  params?: Record<string, any> | undefined;
};

/**
 * Utility to parse a path string to initial state object accepted by the container.
 * This is useful for deep linking when we need to handle the incoming URL.
 *
 * @example
 * ```js
 * getStateFromPath(
 *   '/chat/jane/42',
 *   {
 *     screens: {
 *       Chat: {
 *         path: 'chat/:author/:id',
 *         parse: { id: Number }
 *       }
 *     }
 *   }
 * )
 * ```
 * @param path Path string to parse and convert, e.g. /foo/bar?count=42.
 * @param options Extra options to fine-tune how to parse the path.
 */
export function getStateFromPath<ParamList extends object>(
  // Start Fork
  this: RouterStore | undefined | void,
  // End Fork
  path: string,
  options?: Options<ParamList>
): ResultState | undefined {
  const { allowUrlParamNormalization, ...optionsToValidate } = options ?? {};
  if (options) {
    validatePathConfig(optionsToValidate);
  }

  const expoHelpers = getExpoHelpers(path);

  if (!expoHelpers) {
    return;
  }

  const initialRoutes: InitialRouteConfig[] = [];

  if (options?.initialRouteName) {
    initialRoutes.push({
      initialRouteName: options.initialRouteName,
      parentScreens: [],
    });
  }

  const screens = options?.screens;

  let remaining = expoHelpers?.nonstandardPathname
    .replace(/\/+/g, '/') // Replace multiple slash (//) with single ones
    .replace(/^\//, '') // Remove extra leading slash
    .replace(/\?.*$/, ''); // Remove query params which we will handle later

  // Make sure there is a trailing slash
  remaining = remaining.endsWith('/') ? remaining : `${remaining}/`;

  const prefix = options?.path?.replace(/^\//, ''); // Remove extra leading slash

  if (prefix) {
    // Make sure there is a trailing slash
    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;

    // If the path doesn't start with the prefix, it's not a match
    if (!remaining.startsWith(normalizedPrefix)) {
      return undefined;
    }

    // Remove the prefix from the path
    remaining = remaining.replace(normalizedPrefix, '');
  }

  if (screens === undefined) {
    // When no config is specified, use the path segments as route names
    const routes = remaining
      .split('/')
      .filter(Boolean)
      .map((segment) => {
        const name = decodeURIComponent(segment);
        return { name };
      });

    if (routes.length) {
      return createNestedStateObject(
        path,
        routes,
        initialRoutes,
        undefined,
        expoHelpers.hash,
        allowUrlParamNormalization
      );
    }

    return undefined;
  }

  // Create a normalized configs array which will be easier to use
  const configs = ([] as RouteConfig[])
    .concat(
      ...Object.keys(screens).map((key) =>
        createNormalizedConfigs(key, screens as PathConfigMap<object>, [], initialRoutes, [])
      )
    )
    //  Start Fork
    // .sort((a, b) => {
    //   // Sort config so that:
    //   // - the most exhaustive ones are always at the beginning
    //   // - patterns with wildcard are always at the end

    //   // If 2 patterns are same, move the one with less route names up
    //   // This is an error state, so it's only useful for consistent error messages
    //   if (a.pattern === b.pattern) {
    //     return b.routeNames.join('>').localeCompare(a.routeNames.join('>'));
    //   }

    //   // If one of the patterns starts with the other, it's more exhaustive
    //   // So move it up
    //   if (a.pattern.startsWith(b.pattern)) {
    //     return -1;
    //   }

    //   if (b.pattern.startsWith(a.pattern)) {
    //     return 1;
    //   }

    //   const aParts = a.pattern.split('/');
    //   const bParts = b.pattern.split('/');

    //   for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    //     // if b is longer, b get higher priority
    //     if (aParts[i] == null) {
    //       return 1;
    //     }
    //     // if a is longer, a get higher priority
    //     if (bParts[i] == null) {
    //       return -1;
    //     }
    //     const aWildCard = aParts[i] === '*' || aParts[i].startsWith(':');
    //     const bWildCard = bParts[i] === '*' || bParts[i].startsWith(':');
    //     // if both are wildcard we compare next component
    //     if (aWildCard && bWildCard) {
    //       continue;
    //     }
    //     // if only a is wild card, b get higher priority
    //     if (aWildCard) {
    //       return 1;
    //     }
    //     // if only b is wild card, a get higher priority
    //     if (bWildCard) {
    //       return -1;
    //     }
    //   }
    //   return bParts.length - aParts.length;
    // });
    .sort(getSortConfigsFn(initialRoutes, this?.routeInfo?.segments));
  // End Fork

  // Check for duplicate patterns in the config
  configs.reduce<Record<string, RouteConfig>>((acc, config) => {
    if (acc[config.pattern]) {
      const a = acc[config.pattern].routeNames;
      const b = config.routeNames;

      // It's not a problem if the path string omitted from a inner most screen
      // For example, it's ok if a path resolves to `A > B > C` or `A > B`
      const intersects =
        a.length > b.length ? b.every((it, i) => a[i] === it) : a.every((it, i) => b[i] === it);

      if (!intersects) {
        throw new Error(
          `Found conflicting screens with the same pattern. The pattern '${
            config.pattern
          }' resolves to both '${a.join(' > ')}' and '${b.join(
            ' > '
          )}'. Patterns must be unique and cannot resolve to more than one screen.`
        );
      }
    }

    return Object.assign(acc, {
      [config.pattern]: config,
    });
  }, {});

  if (remaining === '/') {
    // We need to add special handling of empty path so navigation to empty path also works
    // When handling empty path, we should only look at the root level config
    const match = configs.find(
      (config) =>
        stripGroupSegmentsFromPath(config.path) === '' &&
        config.routeNames.every(
          // Make sure that none of the parent configs have a non-empty path defined
          (name) => !stripGroupSegmentsFromPath(configs.find((c) => c.screen === name)?.path || '')
        )
    );

    if (match) {
      return createNestedStateObject(
        expoHelpers.cleanPath,
        match.routeNames.map((name) => ({ name })),
        initialRoutes,
        configs,
        expoHelpers.hash,
        allowUrlParamNormalization
      );
    }

    return undefined;
  }

  let result: PartialState<NavigationState> | undefined;
  let current: PartialState<NavigationState> | undefined;

  // We match the whole path against the regex instead of segments
  // This makes sure matches such as wildcard will catch any unmatched routes, even if nested
  const { routes, remainingPath } = matchAgainstConfigs(
    remaining,
    // Start Fork
    // Our forked configs will already have the '$' suffix
    // configs.map((c) => ({
    //   ...c,
    //   // Add `$` to the regex to make sure it matches till end of the path and not just beginning
    //   regex: c.regex ? new RegExp(c.regex.source + '$') : undefined,
    // }))
    configs
    // End Fork
  );

  if (routes !== undefined) {
    // This will always be empty if full path matched
    current = createNestedStateObject(
      expoHelpers.cleanPath,
      routes,
      initialRoutes,
      configs,
      expoHelpers.hash,
      allowUrlParamNormalization
    );
    remaining = remainingPath;
    result = current;
  }

  if (current == null || result == null) {
    return undefined;
  }

  return result;
}

const joinPaths = (...paths: string[]): string =>
  ([] as string[])
    .concat(...paths.map((p) => p.split('/')))
    .filter(Boolean)
    .join('/');

const matchAgainstConfigs = (remaining: string, configs: RouteConfig[]) => {
  let routes: ParsedRoute[] | undefined;
  let remainingPath = remaining;

  // Go through all configs, and see if the next path segment matches our regex
  for (const config of configs) {
    if (!config.regex) {
      continue;
    }

    const match = remainingPath.match(config.regex);

    // If our regex matches, we need to extract params from the path
    if (match) {
      const matchResult = config.pattern?.split('/').reduce<{
        pos: number; // Position of the current path param segment in the path (e.g in pattern `a/:b/:c`, `:a` is 0 and `:b` is 1)
        matchedParams: Record<string, Record<string, string>>; // The extracted params
      }>(
        (acc, p, index) => {
          if (!p.startsWith(':') && !p.startsWith('*')) {
            return acc;
          }

          if (p === '*') return acc;

          // Path parameter so increment position for the segment
          acc.pos += 1;

          // Start Fork
          // const decodedParamSegment = decodeURIComponent(
          //   // The param segments appear every second item starting from 2 in the regex match result
          //   match![(acc.pos + 1) * 2]
          //     // Remove trailing slash
          //     .replace(/\/$/, '')
          // );

          // Object.assign(acc.matchedParams, {
          //   [p]: Object.assign(acc.matchedParams[p] || {}, {
          //     [index]: decodedParamSegment,
          //   }),
          // });

          // Expo Router's regex is slightly different and may cause an undefined match
          // The param segments appear every second item starting from 2 in the regex match result
          let matchedParam = match![(acc.pos + 1) * 2];
          if (!matchedParam) return acc;

          // Remove trailing slash
          matchedParam = matchedParam.replace(/\/$/, '');

          const decodedParamSegment = decodeURIComponent(matchedParam);

          Object.assign(acc.matchedParams, {
            [p]: Object.assign(acc.matchedParams[p] || {}, {
              [index]: decodedParamSegment,
            }),
          });
          //  End Fork

          return acc;
        },
        { pos: -1, matchedParams: {} }
      );

      const matchedParams = matchResult.matchedParams || {};

      routes = config.routeNames.map((name) => {
        const routeConfig = configs.find((c) => {
          // Check matching name AND pattern in case same screen is used at different levels in config
          return c.screen === name && config.pattern.startsWith(c.pattern);
        });

        // Normalize pattern to remove any leading, trailing slashes, duplicate slashes etc.
        const normalizedPath = routeConfig?.path.split('/').filter(Boolean).join('/');

        // Get the number of segments in the initial pattern
        const numInitialSegments = routeConfig?.pattern
          // Extract the prefix from the pattern by removing the ending path pattern (e.g pattern=`a/b/c/d` and normalizedPath=`c/d` becomes `a/b`)
          .replace(new RegExp(`${escape(normalizedPath!)}$`), '')
          ?.split('/').length;

        const params = normalizedPath
          ?.split('/')
          .reduce<Record<string, unknown>>((acc, p, index) => {
            if (!p.startsWith(':') && !p.startsWith('*')) {
              return acc;
            }

            // Get the real index of the path parameter in the matched path
            // by offsetting by the number of segments in the initial pattern
            const offset = numInitialSegments ? numInitialSegments - 1 : 0;
            const value = matchedParams[p]?.[index + offset];

            if (value) {
              const key = p.replace(/^[:*]/, '').replace(/\?$/, '');
              acc[key] = routeConfig?.parse?.[key] ? routeConfig.parse[key](value) : value;
            }

            return acc;
          }, {});

        if (params && Object.keys(params).length) {
          return { name, params };
        }

        return { name };
      });

      // Start Fork
      // Combine all params so a route `[foo]/[bar]/other.js` has access to `{ foo, bar }`
      // However this needs to be a cascading override. e.g /foo/:id/bar/:id. A layout at /foo/_layout will see the first :id
      // TODO: This behavior is inherited from React Navigation. Do we want this behavior, or should we error?
      const mergedParams = Object.assign({}, ...routes.map((route) => route.params));
      if (Object.keys(mergedParams).length > 0) {
        routes.forEach((route) => {
          route.params = { ...mergedParams };
        });
      }
      // End Fork

      remainingPath = remainingPath.replace(match[1], '');

      break;
    }
  }

  return { routes, remainingPath };
};

const createNormalizedConfigs = (
  screen: string,
  routeConfig: PathConfigMap<object>,
  routeNames: string[] = [],
  initials: InitialRouteConfig[],
  parentScreens: string[],
  parentPattern?: string
): RouteConfig[] => {
  const configs: RouteConfig[] = [];

  routeNames.push(screen);

  parentScreens.push(screen);

  const config = routeConfig[screen];

  if (typeof config === 'string') {
    // If a string is specified as the value of the key(e.g. Foo: '/path'), use it as the pattern
    const pattern = parentPattern ? joinPaths(parentPattern, config) : config;

    configs.push(
      createConfigItem(
        screen,
        routeNames,
        pattern,
        config,
        // Start fork
        undefined,
        false
        // End fork
      )
    );
  } else if (typeof config === 'object') {
    let pattern: string | undefined;

    // if an object is specified as the value (e.g. Foo: { ... }),
    // it can have `path` property and
    // it could have `screens` prop which has nested configs
    if (typeof config.path === 'string') {
      if (config.exact && config.path === undefined) {
        throw new Error(
          "A 'path' needs to be specified when specifying 'exact: true'. If you don't want this screen in the URL, specify it as empty string, e.g. `path: ''`."
        );
      }

      pattern =
        config.exact !== true
          ? joinPaths(parentPattern || '', config.path || '')
          : config.path || '';

      configs.push(
        createConfigItem(
          screen,
          routeNames,
          pattern!,
          config.path,
          config.parse,
          // Start fork
          config.screens ? !!Object.keys(config.screens)?.length : false,
          config._route
          // End fork
        )
      );
    }

    if (config.screens) {
      // property `initialRouteName` without `screens` has no purpose
      if (config.initialRouteName) {
        initials.push({
          initialRouteName: config.initialRouteName,
          parentScreens,
        });
      }

      Object.keys(config.screens).forEach((nestedConfig) => {
        const result = createNormalizedConfigs(
          nestedConfig,
          config.screens as PathConfigMap<object>,
          routeNames,
          initials,
          [...parentScreens],
          pattern ?? parentPattern
        );

        configs.push(...result);
      });
    }
  }

  routeNames.pop();

  return configs;
};

const createConfigItem = (
  screen: string,
  routeNames: string[],
  pattern: string,
  path: string,
  parse?: ParseConfig,
  // Start fork
  hasChildren?: boolean,
  _route?: any
  // End fork
): RouteConfig => {
  // Normalize pattern to remove any leading, trailing slashes, duplicate slashes etc.
  // Start Fork
  pattern = pattern.split('/').filter(Boolean).join('/');

  // const regex = pattern
  //   ? new RegExp(
  //       `^(${pattern
  //         .split('/')
  //         .map((it) => {
  //           if (it.startsWith(':')) {
  //             return `(([^/]+\\/)${it.endsWith('?') ? '?' : ''})`;
  //           }

  //           return `${it === '*' ? '.*' : escape(it)}\\/`;
  //         })
  //         .join('')})`
  //     )
  //   : undefined;
  const regex = pattern
    ? new RegExp(`^${pattern.split('/').map(formatRegexPattern).join('')}$`)
    : undefined;
  // End Fork

  return {
    screen,
    regex,
    pattern,
    path,
    // The routeNames array is mutated, so copy it to keep the current state
    routeNames: [...routeNames],
    parse,
    // Start fork
    expandedRouteNames: routeNames.flatMap((name) => {
      return name.split('/');
    }),
    userReadableName: [...routeNames.slice(0, -1), path || screen].join('/'),
    hasChildren: !!hasChildren,
    _route,
    // End fork
  };
};

const findParseConfigForRoute = (
  routeName: string,
  flatConfig: RouteConfig[]
): ParseConfig | undefined => {
  for (const config of flatConfig) {
    if (routeName === config.routeNames[config.routeNames.length - 1]) {
      return config.parse;
    }
  }

  return undefined;
};

// Try to find an initial route connected with the one passed
const findInitialRoute = (
  routeName: string,
  parentScreens: string[],
  initialRoutes: InitialRouteConfig[]
): string | undefined => {
  for (const config of initialRoutes) {
    if (parentScreens.length === config.parentScreens.length) {
      let sameParents = true;
      for (let i = 0; i < parentScreens.length; i++) {
        if (parentScreens[i].localeCompare(config.parentScreens[i]) !== 0) {
          sameParents = false;
          break;
        }
      }
      if (sameParents) {
        return routeName !== config.initialRouteName ? config.initialRouteName : undefined;
      }
    }
  }
  return undefined;
};

// returns state object with values depending on whether
// it is the end of state and if there is initialRoute for this level
const createStateObject = (
  initialRoute: string | undefined,
  route: ParsedRoute,
  isEmpty: boolean
): InitialState => {
  if (isEmpty) {
    if (initialRoute) {
      return {
        index: 1,
        // Start fork
        // routes: [{ name: initialRoute }, route],
        routes: [{ name: initialRoute, params: route.params }, route],
        // End fork
      };
    } else {
      return {
        routes: [route],
      };
    }
  } else {
    if (initialRoute) {
      return {
        index: 1,
        routes: [
          // Start fork
          // { name: initialRoute },
          { name: initialRoute, params: route.params },
          // End fork
          { ...route, state: { routes: [] } },
        ],
      };
    } else {
      return {
        routes: [{ ...route, state: { routes: [] } }],
      };
    }
  }
};

const createNestedStateObject = (
  path: string,
  routes: ParsedRoute[],
  initialRoutes: InitialRouteConfig[],
  flatConfig?: RouteConfig[],
  // Start Fork
  hash?: string,
  allowUrlParamNormalization?: boolean
  // End fork
) => {
  let route = routes.shift() as ParsedRoute;
  const parentScreens: string[] = [];

  let initialRoute = findInitialRoute(route.name, parentScreens, initialRoutes);

  parentScreens.push(route.name);

  const state: InitialState = createStateObject(initialRoute, route, routes.length === 0);

  if (routes.length > 0) {
    let nestedState = state;

    while ((route = routes.shift() as ParsedRoute)) {
      initialRoute = findInitialRoute(route.name, parentScreens, initialRoutes);

      const nestedStateIndex = nestedState.index || nestedState.routes.length - 1;

      nestedState.routes[nestedStateIndex].state = createStateObject(
        initialRoute,
        route,
        routes.length === 0
      );

      if (routes.length > 0) {
        nestedState = nestedState.routes[nestedStateIndex].state as InitialState;
      }

      parentScreens.push(route.name);
    }
  }

  route = findFocusedRoute(state) as ParsedRoute;
  route.path = path;

  const params = parseQueryParams(
    path,
    flatConfig ? findParseConfigForRoute(route.name, flatConfig) : undefined,
    hash
  );

  if (params) {
    // Start fork
    // route.params = { ...route.params, ...params };
    forks.mutateRouteParams(route, params, { allowUrlParamNormalization });
    // End fork
  }

  return state;
};

// Start fork - this function was replaced
// const parseQueryParams = (
//   path: string,
//   parseConfig?: Record<string, (value: string) => any>
// ) => {
//   const query = path.split('?')[1];
//   const params = queryString.parse(query);

//   if (parseConfig) {
//     Object.keys(params).forEach((name) => {
//       if (
//         Object.hasOwnProperty.call(parseConfig, name) &&
//         typeof params[name] === 'string'
//       ) {
//         params[name] = parseConfig[name](params[name] as string);
//       }
//     });
//   }

//   return Object.keys(params).length ? params : undefined;
// };
const parseQueryParams = forks.parseQueryParams;
// End fork

// Start Fork
const baseUrlCache = new Map<string, RegExp>();
export function stripBaseUrl(
  path: string,
  baseUrl: string | undefined = process.env.EXPO_BASE_URL
) {
  if (process.env.NODE_ENV !== 'development') {
    if (baseUrl) {
      const reg = getBaseUrlRegex(baseUrl);
      return path.replace(/^\/+/g, '/').replace(reg, '');
    }
  }
  return path;
}

function getBaseUrlRegex(baseUrl: string) {
  if (baseUrlCache.has(baseUrl)) {
    return baseUrlCache.get(baseUrl)!;
  }
  const regex = new RegExp(`^\\/?${escape(baseUrl)}`, 'g');
  baseUrlCache.set(baseUrl, regex);
  return regex;
}
// End Fork

// Start Fork
export function getExpoHelpers(
  path: string,
  baseUrl: string | undefined = process.env.EXPO_BASE_URL
) {
  const expoURL = getUrlWithReactNavigationConcessions(path, baseUrl);

  if (!expoURL.url) {
    return;
  }

  let cleanPath =
    stripBaseUrl(stripGroupSegmentsFromPath(expoURL.url.pathname), baseUrl) + expoURL.url.search;

  if (!path.startsWith('/')) cleanPath = cleanPath.slice(1);

  return {
    cleanPath,
    hash: expoURL.url.hash.slice(1),
    ...expoURL,
  };
}
// End Fork

// Start Fork
export function getUrlWithReactNavigationConcessions(path: string, baseUrl?: string) {
  let parsed: URL;
  try {
    parsed = new URL(path, 'https://phony.example');
  } catch {
    // Do nothing with invalid URLs.
    return {
      nonstandardPathname: '',
      inputPathnameWithoutHash: '',
      url: null,
    };
  }

  const pathname = parsed.pathname;

  // Make sure there is a trailing slash
  return {
    // The slashes are at the end, not the beginning
    nonstandardPathname:
      stripBaseUrl(pathname, baseUrl).replace(/^\/+/g, '').replace(/\/+$/g, '') + '/',
    url: parsed,
  };
}
// End Fork

// Start fork
function formatRegexPattern(it: string): string {
  // Allow spaces in file path names.
  it = it.replace(' ', '%20');

  if (it.startsWith(':')) {
    // TODO: Remove unused match group
    return `(([^/]+\\/)${it.endsWith('?') ? '?' : ''})`;
  } else if (it.startsWith('*')) {
    return `((.*\\/)${it.endsWith('?') ? '?' : ''})`;
  }

  // Strip groups from the matcher
  if (matchGroupName(it) != null) {
    // Groups are optional segments
    // this enables us to match `/bar` and `/(foo)/bar` for the same route
    // NOTE(EvanBacon): Ignore this match in the regex to avoid capturing the group
    return `(?:${escape(it)}\\/)?`;
  }

  return escape(it) + `\\/`;
}
// End Fork

// Start Fork
function getSortConfigsFn(initialRoutes: InitialRouteConfig[], previousSegments: string[] = []) {
  const initialPatterns = initialRoutes.map((route) =>
    joinPaths(...route.parentScreens, route.initialRouteName)
  );

  return function sortConfigs(a: RouteConfig, b: RouteConfig): number {
    // Sort config so that:
    // - the most exhaustive ones are always at the beginning
    // - patterns with wildcard are always at the end

    // If 2 patterns are same, move the one with less route names up
    // This is an error state, so it's only useful for consistent error messages
    if (a.pattern === b.pattern) {
      return b.routeNames.join('>').localeCompare(a.routeNames.join('>'));
    }

    // If one of the patterns starts with the other, it's more exhaustive
    // So move it up
    if (
      a.pattern.startsWith(b.pattern) &&
      // NOTE(EvanBacon): This is a hack to make sure that `*` is always at the end
      b.screen !== 'index'
    ) {
      return -1;
    }

    if (b.pattern.startsWith(a.pattern) && a.screen !== 'index') {
      return 1;
    }

    // NOTE(EvanBacon): Here we append `index` if the screen was `index` so the length is the same
    // as a slug or wildcard when nested more than one level deep.
    // This is so we can compare the length of the pattern, e.g. `foo/*` > `foo` vs `*` < ``.
    const aParts = a.pattern
      .split('/')
      // Strip out group names to ensure they don't affect the priority.
      .filter((part) => matchGroupName(part) == null);
    if (a.screen === 'index' || a.screen.match(/\/index$/)) {
      aParts.push('index');
    }

    const bParts = b.pattern.split('/').filter((part) => matchGroupName(part) == null);
    if (b.screen === 'index' || b.screen.match(/\/index$/)) {
      bParts.push('index');
    }

    const isAStaticRoute =
      !a.hasChildren && // Layout configs will have children
      !aParts.some(
        (part) => part.startsWith(':') || part.startsWith('*') || part.includes('*not-found')
      );
    const isBStaticRoute =
      !b.hasChildren &&
      !bParts.some(
        (part) => part.startsWith(':') || part.startsWith('*') || part.includes('*not-found')
      );

    /*
     * Static routes should always be higher than dynamic routes.
     * Layouts are excluded from this and are ranked lower than routes
     */
    if (isAStaticRoute && !isBStaticRoute) {
      return -1;
    } else if (!isAStaticRoute && isBStaticRoute) {
      return 1;
    }

    /*
     * If both are static/dynamic or a layout file, then we check group similarity
     */
    const similarToPreviousA = previousSegments.filter((value, index) => {
      return value === a.expandedRouteNames[index] && value.startsWith('(') && value.endsWith(')');
    });

    const similarToPreviousB = previousSegments.filter((value, index) => {
      return value === b.expandedRouteNames[index] && value.startsWith('(') && value.endsWith(')');
    });

    if (
      (similarToPreviousA.length > 0 || similarToPreviousB.length > 0) &&
      similarToPreviousA.length !== similarToPreviousB.length
    ) {
      // One matches more than the other, so pick the one that matches more
      return similarToPreviousB.length - similarToPreviousA.length;
    }

    /*
     * If there is not difference in similarity, then each non-group segment is compared against each other
     */
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      // if b is longer, b get higher priority
      if (aParts[i] == null) {
        return 1;
      }
      // if a is longer, a get higher priority
      if (bParts[i] == null) {
        return -1;
      }

      const aWildCard = aParts[i].startsWith('*');
      const bWildCard = bParts[i].startsWith('*');
      // if both are wildcard we compare next component
      if (aWildCard && bWildCard) {
        const aNotFound = aParts[i].match(/^[*]not-found$/);
        const bNotFound = bParts[i].match(/^[*]not-found$/);

        if (aNotFound && bNotFound) {
          continue;
        } else if (aNotFound) {
          return 1;
        } else if (bNotFound) {
          return -1;
        }
        continue;
      }
      // if only a is wild card, b get higher priority
      if (aWildCard) {
        return 1;
      }
      // if only b is wild card, a get higher priority
      if (bWildCard) {
        return -1;
      }

      const aSlug = aParts[i].startsWith(':');
      const bSlug = bParts[i].startsWith(':');
      // if both are wildcard we compare next component
      if (aSlug && bSlug) {
        const aNotFound = aParts[i].match(/^[*]not-found$/);
        const bNotFound = bParts[i].match(/^[*]not-found$/);

        if (aNotFound && bNotFound) {
          continue;
        } else if (aNotFound) {
          return 1;
        } else if (bNotFound) {
          return -1;
        }

        continue;
      }
      // if only a is wild card, b get higher priority
      if (aSlug) {
        return 1;
      }
      // if only b is wild card, a get higher priority
      if (bSlug) {
        return -1;
      }
    }

    /*
     * Both configs are identical in specificity and segments count/type
     * Try and sort by initial instead.
     *
     * TODO: We don't differentiate between the default initialRoute and group specific default routes
     *
     * const unstable_settings = {
     *   "group": {
     *     initialRouteName: "article"
     *  }
     * }
     *
     * "article" will be ranked higher because its an initialRoute for a group - even if not your not currently in
     * that group. The current work around is to ways provide initialRouteName for all groups
     */
    const aIsInitial = initialPatterns.includes(a.routeNames.join('/'));
    const bIsInitial = initialPatterns.includes(b.routeNames.join('/'));

    if (aIsInitial && !bIsInitial) {
      return -1;
    } else if (!aIsInitial && bIsInitial) {
      return 1;
    }

    return bParts.length - aParts.length;
  };
}
// End fork
