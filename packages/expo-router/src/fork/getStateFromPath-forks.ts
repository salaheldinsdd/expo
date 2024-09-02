import type { ParsedRoute } from './getStateFromPath';

export function mutateRouteParams(
  route: ParsedRoute,
  params: object,
  { allowUrlParamNormalization = false } = {}
) {
  route.params = Object.assign(Object.create(null), route.params) as Record<string, any>;
  for (const [name, value] of Object.entries(params)) {
    if (route.params?.[name]) {
      if (allowUrlParamNormalization) {
        route.params[name] = value;
      } else {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `Route '/${route.name}' with param '${name}' was specified both in the path and as a param, removing from path`
          );
        }
      }
    } else {
      route.params[name] = value;
    }
  }

  if (Object.keys(route.params).length === 0) {
    delete route.params;
  }
}

export function parseQueryParams(
  path: string,
  parseConfig?: Record<string, (value: string) => any>,
  hash?: string
) {
  const searchParams = new URL(path, 'https://phony.example').searchParams;
  const params: Record<string, string | string[]> = Object.create(null);

  if (hash) {
    params['#'] = hash;
  }

  for (const name of searchParams.keys()) {
    const values = parseConfig?.hasOwnProperty(name)
      ? searchParams.getAll(name).map((value) => parseConfig[name](value))
      : searchParams.getAll(name);

    // searchParams.getAll returns an array.
    // if we only have a single value, and its not an array param, we need to extract the value
    params[name] = values.length === 1 ? values[0] : values;
  }

  return Object.keys(params).length ? params : undefined;
}
