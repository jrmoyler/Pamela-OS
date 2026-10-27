import { test } from "node:test";
import assert from "node:assert/strict";
import { STARTERS, aspectSize, capabilityFor, composePrompt, connect, normalizeGraph, topoOrder, type FlowGraph } from "../src/lib/studio/graph";
import { DEFAULT_COMFY_T2I, fillWorkflow, urlsIn } from "../src/lib/studio/engines";

const node = (id: string, type: string, x = 0) => ({ id, type, x, y: 0, data: {} });

test("wires only join ports of the same type", () => {
  const g = normalizeGraph({ nodes: [node("p", "prompt"), node("i", "image"), node("g", "generate_image")], edges: [] });
  const ok = connect(g, { from: "p", fromPort: "text", to: "g", toPort: "prompt" }, "e1");
  assert.equal(ok.edges.length, 1);
  const wrongType = connect(g, { from: "p", fromPort: "text", to: "g", toPort: "reference" }, "e2");
  assert.equal(wrongType.edges.length, 0);
  const self = connect(g, { from: "g", fromPort: "image", to: "g", toPort: "reference" }, "e3");
  assert.equal(self.edges.length, 0);
});

test("a single-input port keeps only the newest wire; multi-input ports keep all", () => {
  let g: FlowGraph = normalizeGraph({ nodes: [node("a", "image"), node("b", "image"), node("p1", "prompt"), node("p2", "prompt"), node("g", "generate_image")], edges: [] });
  g = connect(g, { from: "a", fromPort: "image", to: "g", toPort: "reference" }, "e1");
  g = connect(g, { from: "b", fromPort: "image", to: "g", toPort: "reference" }, "e2");
  assert.deepEqual(g.edges.map((e) => e.from), ["b"]);
  g = connect(g, { from: "p1", fromPort: "text", to: "g", toPort: "prompt" }, "e3");
  g = connect(g, { from: "p2", fromPort: "text", to: "g", toPort: "prompt" }, "e4");
  assert.equal(g.edges.filter((e) => e.toPort === "prompt").length, 2);
});

test("cycles are refused and run order puts inputs first", () => {
  let g: FlowGraph = normalizeGraph({ nodes: [node("u", "upscale"), node("r", "remove_bg"), node("i", "image")], edges: [] });
  g = connect(g, { from: "i", fromPort: "image", to: "r", toPort: "image" }, "e1");
  g = connect(g, { from: "r", fromPort: "image", to: "u", toPort: "image" }, "e2");
  const looped = connect(g, { from: "u", fromPort: "image", to: "r", toPort: "image" }, "e3");
  assert.equal(looped.edges.find((e) => e.id === "e3"), undefined);
  assert.deepEqual(topoOrder(g).map((n) => n.id), ["i", "r", "u"]);
});

test("normalizeGraph drops unknown nodes, dangling and mistyped wires, and fills defaults", () => {
  const g = normalizeGraph({
    nodes: [node("p", "prompt"), node("x", "not_a_node"), { id: "g", type: "generate_image", x: "bad", y: 3, data: { count: 4 } }],
    edges: [
      { id: "ok", from: "p", fromPort: "text", to: "g", toPort: "prompt" },
      { id: "dangling", from: "x", fromPort: "text", to: "g", toPort: "prompt" },
      { id: "typed", from: "p", fromPort: "text", to: "g", toPort: "brand" },
    ],
  });
  assert.deepEqual(g.nodes.map((n) => n.id), ["p", "g"]);
  assert.deepEqual(g.edges.map((e) => e.id), ["ok"]);
  assert.equal(g.nodes[1].x, 0);
  assert.equal(g.nodes[1].data.count, 4);
  assert.equal(g.nodes[1].data.aspect, "1:1");
});

test("every starter canvas is a valid graph", () => {
  for (const s of STARTERS) {
    const built = s.build();
    const clean = normalizeGraph(built);
    assert.equal(clean.edges.length, built.edges.length, `${s.key} has an invalid wire`);
    assert.equal(topoOrder(clean).length, clean.nodes.length, `${s.key} has a cycle`);
  }
});

test("capability follows whether a node has an image to start from", () => {
  assert.equal(capabilityFor("generate_image", false), "image");
  assert.equal(capabilityFor("generate_image", true), "edit");
  assert.equal(capabilityFor("generate_video", false), "video_t2v");
  assert.equal(capabilityFor("generate_video", true), "video_i2v");
  assert.equal(capabilityFor("prompt", true), null);
});

test("brand prompt adds art direction and keeps lettering out of the image", () => {
  const plain = composePrompt(["A mother and son", "morning light"], null);
  assert.equal(plain, "A mother and son. morning light");
  const branded = composePrompt(["A mother and son"], { name: "A Cup of Compassion", tagline: "", visualStyle: "Warm, purple accents" });
  assert.match(branded, /A Cup of Compassion: Warm, purple accents/);
  assert.match(branded, /No words, letters or logos/);
});

test("aspect sizes stay near one megapixel in multiples of 64", () => {
  for (const a of ["1:1", "9:16", "16:9", "4:5"]) {
    const { width, height } = aspectSize(a);
    assert.equal(width % 64, 0);
    assert.equal(height % 64, 0);
    assert.ok(width * height > 800_000 && width * height < 1_300_000, a);
  }
  assert.deepEqual(aspectSize("9:16").width < aspectSize("9:16").height, true);
});

test("ComfyUI placeholders become typed values or interpolated text", () => {
  const wf = fillWorkflow(DEFAULT_COMFY_T2I, { prompt: "a cup", negative: "blur", seed: 42, width: 1024, height: 768, count: 2, checkpoint: "flux.safetensors" }) as typeof DEFAULT_COMFY_T2I;
  assert.equal(wf["3"].inputs.seed, 42);
  assert.equal(wf["5"].inputs.width, 1024);
  assert.equal(wf["4"].inputs.ckpt_name, "flux.safetensors");
  assert.equal(wf["6"].inputs.text, "a cup");
  assert.deepEqual(wf["3"].inputs.model, ["4", 0]);
  assert.equal(fillWorkflow("photo of {{prompt}}, {{unknown}}", { prompt: "tea" }), "photo of tea, {{unknown}}");
});

test("engine outputs are found in every shape the hosts return", () => {
  assert.deepEqual(urlsIn("https://x/a.png"), ["https://x/a.png"]);
  assert.deepEqual(urlsIn(["https://x/a.png", "https://x/b.png"]), ["https://x/a.png", "https://x/b.png"]);
  assert.deepEqual(urlsIn({ images: [{ url: "https://f/1.png" }, { url: "https://f/2.png" }] }), ["https://f/1.png", "https://f/2.png"]);
  assert.deepEqual(urlsIn({ image: { url: "https://f/up.png" } }), ["https://f/up.png"]);
  assert.deepEqual(urlsIn({ video: { url: "https://f/v.mp4" }, seed: 3 }), ["https://f/v.mp4"]);
  assert.deepEqual(urlsIn({ seed: 1, prompt: "not a url" }), []);
});
