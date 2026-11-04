/**
 * @param {{ service: string, version: string }} config
 */
export function createHealthService(config) {
  return {
    getHealth() {
      return { status: 'ok', service: config.service, version: config.version };
    },
  };
}
