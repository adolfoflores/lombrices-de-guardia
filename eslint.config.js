import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'release/**', 'docs/evidence/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-unreachable': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-dupe-keys': 'error',
      'no-import-assign': 'error',
      'no-func-assign': 'error',
      'no-class-assign': 'error',
      'no-ex-assign': 'error',
      'no-obj-calls': 'error',
      'no-unsafe-finally': 'error',
      'no-this-before-super': 'error',
      'constructor-super': 'error',
      'valid-typeof': 'error',
      'use-isnan': 'error',
    },
  },
  { files: ['client/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['server/**/*.js', 'shared/**/*.js', '*.config.js'], languageOptions: { globals: globals.node } },
  {
    files: ['scripts/**/*.js', 'tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
