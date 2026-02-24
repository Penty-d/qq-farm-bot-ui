import antfu from '@antfu/eslint-config'

export default antfu({
  formatters: true,
  typescript: true,
}, {
  files: ['**/*.cjs', '**/*.js'],
  rules: {
    'no-console': 'off',
    'ts/no-require-imports': 'off',
    'import/no-commonjs': 'off',
    'style/max-statements-per-line': 'off',
    'unused-imports/no-unused-vars': 'off',
    'no-unused-vars': 'off',
    'jsdoc/require-returns-description': 'off',
    'no-cond-assign': 'off',
    'regexp/no-unused-capturing-group': 'off',
  },
})
