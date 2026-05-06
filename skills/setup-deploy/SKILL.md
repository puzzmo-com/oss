---
name: setup-deploy
description: Configure the Puzzmo CLI for uploading game builds
---

# Setup Deploy

Configure the project to deploy game builds to Puzzmo using the CLI.

## Steps

1. Install the Puzzmo CLI as a dev dependency:

   ```
   Install @puzzmo/cli as a dev dependency using the project's package manager (e.g. npm, yarn, pnpm).
   ```

2. Add deploy scripts to `package.json`:

   ```json
   {
     "scripts": {
       "deploy": "npm run build && puzzmo upload",
       "deploy:only": "puzzmo upload"
     }
   }
   ```

3. The CLI discovers the game slug from `puzzmo.json` automatically.

4. Create a `.gitignore` if it doesn't exist, including:

   ```
   node_modules/
   dist/
   .env
   ```

5. Initialize a git repository if not already initialized:

   ```
   git init
   ```

6. Add a `README.md` with basic instructions:

   ```markdown
   # Game Name

   ## Development

   Run the `dev` script to start development.

   ## Build

   Run the `build` script to create a production build.

   ## Deploy

   puzzmo login <your-token>
   Run the `deploy` script to upload to Puzzmo.
   ```

## Success Criteria

- The `build` script completes without errors
- `puzzmo upload` command is configured in package.json
- `.gitignore` excludes node_modules and dist
- Game slug matches across all config files
