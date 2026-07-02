module.exports = {
  env:     { es2020: true, node: true },
  extends: ['eslint:recommended'],
  rules: {
    'no-console': 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
  }
};
