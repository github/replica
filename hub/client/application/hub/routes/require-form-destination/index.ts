export function requireFormDestination(
  source: URL,
  method: string,
  path: string,
  methods: string[],
) {
  if (source.pathname !== path || !methods.includes(method)) {
    throw new Response(
      `This page requires a ${methods.map((value) => value.toUpperCase()).join(" or ")} form targeting ${path}.`,
      { status: 422 },
    )
  }
}
