export const hiddenStorage = {
  getItem: (name) => {
    const raw = sessionStorage.getItem(name);
    if (!raw) return null;
    return atob(raw);
  },
  setItem: (name, value) => {
    sessionStorage.setItem(name, btoa(value));
  },
  removeItem: (name) => sessionStorage.removeItem(name),
};