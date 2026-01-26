const ENV = 'prod';
const BETA = false;

const CONFIG = {
  local: { API_BASE: 'http://127.0.0.1:8000' },
  dev: { API_BASE: 'https://brainful.dev' },
  prod: { API_BASE: BETA ? 'https://beta.brainful.one' : 'https://brainful.one' },
};

export const API_BASE = CONFIG[ENV].API_BASE;
export const CURRENT_ENV = ENV;
export const IS_BETA = BETA;
