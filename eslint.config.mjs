import cds from "@sap/cds/eslint.config.mjs"
export default [
  ...cds,
  {
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", reportUsedIgnorePattern: true },
      ],
    },
  },
  {
    name: "test-files-config",
    files: ["tests/**/*"],
    rules: {
      "no-console": "off",
    },
  },
]
