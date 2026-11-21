# Universe

The local scaffold reports launcher availability over HTTP and uses only Node.js built-ins.

## Run locally

From an Ubuntu terminal with Node.js and npm available, run the following commands.

```sh
cd /var/www/demo_stuff/universe
npm start
```

Open [the launcher status](http://127.0.0.1:8767/). The response reads `Universe launcher is running.` Press Ctrl+C in the terminal to stop the server.

## Reserved local directories

- `local/SillyTavern/` will hold the upstream SillyTavern installation.
- `local/data/` will hold SillyTavern's private data.

Both directories can be absent when the launcher starts. Git ignores the entire `local/` tree.

Future milestones include launching SillyTavern in a dedicated window and saving and restoring story data through Cloudflare.
