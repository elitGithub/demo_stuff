# Tavern Scenario Builder as a Universe dependency

## Requirement

A fresh checkout on Linux or Windows gets Tavern Scenario Builder with `npm install` or `npm ci`. Opening the normally built Universe app shows the wizard hat beside Group Chats, including for a fresh SillyTavern profile. Installation must work with the project's existing `ignore-scripts=true` setting.

## Package and build

Declare a production dependency named `tavern-scenario-builder` in Universe's `package.json` and record it in `package-lock.json`. Bundle it as a repository-relative npm tarball with its SHA-512 integrity recorded in the lockfile. The upstream [revision e27b831](https://github.com/Copenblend/tavernScenarioBuilder/tree/e27b831f66240ac0c4c1d9acd7ba8c182d29f70b) provides version 1.1.0. It contains its SillyTavern manifest but lacks npm package metadata. The private package will supply that metadata and preserve the upstream runtime files, attribution and source revision. Assets must come from the pinned archive, independently of any installed user profile.

The existing build assembles SillyTavern through a second `npm ci` in a temporary directory. Stage the local tarball at the same relative path for that install. Package the extension's runtime files in SillyTavern's global `public/scripts/extensions/third-party/tavernScenarioBuilder/` directory within the generated application. The exact spelling is part of the wizard's template URL. Make an existing build missing the extension eligible for rebuilding. Respect existing user extensions and SillyTavern's normal profile override behavior.

An interrupted upgrade can leave an intact older build as the only backup. The builder must recognize that backup using the requirements for its original layout and restore it even if the application source is unavailable. Upgrade it to include the extension when the required build inputs are available. A successful fresh build must always contain the extension.

## Verification

Run clean `npm install` and `npm ci` checks with lifecycle scripts disabled, in isolated project directories without any existing profile or dependency tree. Verify the package version, integrity and required files. Exercise the build and check extension discovery with an empty profile, including the manifest, entry point, module imports, stylesheet and Scenario template. Use the build's `--if-missing` entry point to exercise both an existing pre-extension build and an interrupted upgrade where only a pre-extension backup survives and the application source is missing. Verify that restoring the missing inputs allows the next build to install the wizard. Use isolated fixtures and offline discovery without starting a SillyTavern or Universe instance. Report which platforms actually ran the checks.
