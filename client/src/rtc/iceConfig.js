import { getIceConfig as fetchIceConfig } from '../api.js';

let cachedConfig = null;
let inflightPromise = null;

export async function getIceConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  if (!inflightPromise) {
    inflightPromise = fetchIceConfig()
      .then((cfg) => {
        cachedConfig = {
          iceServers: Array.isArray(cfg?.iceServers)
            ? cfg.iceServers
            : [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
          maxBitrate: Number(cfg?.maxBitrate) || 1500000,
        };
        return cachedConfig;
      })
      .finally(() => {
        inflightPromise = null;
      });
  }
  return inflightPromise;
}
