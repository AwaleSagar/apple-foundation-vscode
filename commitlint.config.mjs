export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [1, 'always', 120],
  },
  ignores: [(message) => message.includes('Version Packages')],
};
