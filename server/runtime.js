export function runtimePort(value = process.env.PORT) {
  const port = Number(value || 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT tidak valid.')
  }
  return port
}
