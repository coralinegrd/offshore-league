const TOKEN_KEY = "offshore_token";
const USER_KEY = "offshore_user";

export function loadAuth() {
  const token = window.localStorage.getItem(TOKEN_KEY);
  const userJson = window.localStorage.getItem(USER_KEY);
  return {
    token,
    user: userJson ? JSON.parse(userJson) : null
  };
}

export function saveAuth({ token, user }) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}
