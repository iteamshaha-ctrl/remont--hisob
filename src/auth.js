const AUTH_DOMAIN = "login.remont-hisob.local";

export const normalizeLoginId = (value = "") => value.trim().toLowerCase();

export const isValidLoginId = (value = "") => /^[a-z0-9][a-z0-9._-]{2,39}$/.test(normalizeLoginId(value));

export const loginIdToEmail = (value = "") => {
  const loginId = normalizeLoginId(value);
  return loginId ? loginId + "@" + AUTH_DOMAIN : "";
};
