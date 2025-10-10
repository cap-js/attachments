import cds from "@sap/cds/eslint.config.mjs"
export default [
  ...cds,
  {
    name: 'test-files-config',
    files: ["tests/**/*"],
    rules: {
      'no-console': 'off',
    }
  },
]
