# feel

Steer your writing by meaning. Select some words, and a ring opens around the screen: each arc is a direction the passage could take, and the further you move toward it, the stronger the change. You see the text change while you move.

It is an experiment in how people could work with language models without describing what they want in a prompt first.

## Try it

```bash
npm start
```

Then open http://localhost:4317. There is nothing to install and no backend: `npm start` only serves the files, and any static host works.

The front page has a tour: the app itself on sample text, playing through each interaction on its own. Move your cursor over it and it is yours to try; it starts again when you leave.

Out of the box it runs on a **simulator** with canned rewrites, which is enough to try the interaction on the sample letter. To use a real model, click **simulator · add key** and paste your own [Cerebras](https://cloud.cerebras.ai) API key. The key is stored only in your browser and sent only to `api.cerebras.ai`.

## How it works

| You do | It does |
| --- | --- |
| Select words | Opens the ring with meanings for that passage. Move toward one; nearer the edge is stronger. |
| Click between words | Opens the ring in write mode: the arcs are moves (give an example, add a result…), and distance is how much to write. |
| Click on the ring | Pins that meaning. Up to four pins combine, joined by bonds. Click a pin to remove it. |
| Type | Asks for anything in your own words. The passage follows, and the ring's options are replaced with ones close to your request. |
| Scroll | New meanings, or back to earlier ones. |
| Push the right edge | Opens your documents. Click a passage to reference it. |
| ← ↓ / → ↑ | Shorter, or back. Tap fast to cut more. Only while nothing is typed. |
| Enter / Esc | Save, or cancel. |
| Cmd+Z / Shift+Cmd+Z | Undo or redo a saved change. |

### Why it feels fast

The interface asks ahead of need, in the way [Spaceship](https://github.com/chuanqisun/spaceship) does. When you select a passage it requests the meanings at every strength, five shorter versions, and the next set of meanings. Each time you pin something, it requests what every further move would give. By the time the cursor arrives, the answer is usually there. Replies are remembered by exact request, so asking early and asking for real share one call.

## Layout

```
index.html, styles.css   the page
src/app.js               the ring: selection, aiming, pins, drawing
src/landing.js           the front page: dot-matrix names, the tour's checklist
src/autopilot.js         the tour playing itself with a ghost cursor
src/documents.js         your reference documents, kept in the browser
src/diff.js, sound.js    word-level diff; synthesized sounds
src/sample.js            the sample letter and placeholder documents
src/llm/index.js         one door to the model: cache, queue, key storage
src/llm/prompts.js       what the model is asked, per request kind
src/llm/cerebras.js      the Cerebras client
src/llm/simulator.js     canned replies for running without a key
explorations/            earlier sketches of the interaction (simulator only)
scripts/serve.mjs        static server for local development
tests/                   run with `npm test`
```

## Status

A prototype. Your text and documents are kept in your browser. The prompts are still being tuned against real models, and it expects a mouse, a keyboard and a wide window.

## Credits

Made by [Edoardo Schiatti](https://github.com/EDEN757).

Inspired by [Spaceship IDE](https://github.com/chuanqisun/spaceship) by Chuanqi Sun, which showed what realtime steering of text could feel like.

## License

[MIT](LICENSE)
