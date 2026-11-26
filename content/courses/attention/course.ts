import type { Course } from "@/lib/content";

export const attention: Course = {
  slug: "attention",
  title: "Harnessing Attention",
  tagline:
    "Escape autopilot — train attention so I'm genuinely present, especially with the people in front of me.",
  blurb: "Train attention for presence. Escape autopilot, one Return at a time.",
  accent: "#7a5c3e",
  accentSoft: "#f3ecdd",
  practice: {
    prompt:
      "Did you do one Return today — in the breath, or mid-conversation with a real person?",
  },
  concepts: [
    {
      slug: "the-return",
      title: "The Return",
      summary: "Notice the wander, gently come back. The atomic rep.",
      body: [
        "The core repetition of attention training: noticing that attention has wandered and gently bringing it back to the anchor — without self-criticism.",
        "The reframe that makes it work: the wander is not the failure. The Return is the rep. A mind that wandered ten times and returned ten times did ten push-ups for attention.",
        "William James: “The faculty of voluntarily bringing back a wandering attention, over and over again, is the very root of judgement, character, and will.”",
      ],
      related: ["mind-wandering", "voluntary-attention", "anchor", "autopilot", "presence"],
      source: {
        label: "James, Principles of Psychology (1890)",
        url: "https://psychclassics.yorku.ca/James/Principles/prin11.htm",
      },
    },
    {
      slug: "mind-wandering",
      title: "Mind-Wandering",
      summary: "The ~47% problem: the mind is elsewhere, and that costs happiness.",
      body: [
        "The mind drifting to something other than the present task or moment.",
        "Killingsworth & Gilbert (2010) sampled thousands of people at random and found the mind is elsewhere ~47% of waking hours — and that wandering, more than the activity itself, predicts unhappiness. “A wandering mind is an unhappy mind.”",
        "Wandering is not a defect to eliminate; it is the raw material for the Return. Chronic, unnoticed wandering hardens into autopilot.",
      ],
      related: ["the-return", "autopilot", "presence"],
      source: {
        label: "A Wandering Mind Is an Unhappy Mind (Science, 2010)",
        url: "https://pdodds.w3.uvm.edu/files/papers/others/2010/killingsworth2010a.pdf",
      },
    },
    {
      slug: "autopilot",
      title: "Autopilot",
      summary: "Acting while mentally absent — the condition we're escaping.",
      body: [
        "Acting while mentally absent — eating without tasting, listening without hearing, a day that disappears. Sustained mind-wandering as a default mode of living.",
        "This is the condition the mission exists to escape: present in body, absent in mind. The antidote is not force but noticing — catching autopilot and doing the Return.",
      ],
      related: ["mind-wandering", "the-return", "presence"],
    },
    {
      slug: "presence",
      title: "Presence",
      summary: "Attention fully resting here. The goal of the whole practice.",
      body: [
        "Attention fully resting in the present moment or person — being here, not merely located here. The felt goal of the mission.",
        "Presence is not a technique but the result of technique: enough repetitions of the Return that resting on the anchor — a meal, a walk, a person's words — becomes the default instead of autopilot.",
      ],
      related: ["the-return", "anchor", "autopilot"],
    },
    {
      slug: "anchor",
      title: "Anchor",
      summary: "What attention rests on — breath, a sound, a person's words.",
      body: [
        "The object you rest attention on — the feeling of the breath, a sound, the other person's words. It gives wandering something to return to.",
        "Choosing an anchor turns a vague intention (“be present”) into a concrete rep: attention is either on the anchor or it isn't, and the moment it isn't, you do the Return. In a presence-and-relationships mission, the highest-value anchor is a live person.",
      ],
      related: ["the-return", "voluntary-attention", "presence"],
    },
    {
      slug: "voluntary-attention",
      title: "Voluntary Attention",
      summary: "Attention placed by effort — the trainable kind (James).",
      body: [
        "Attention deliberately placed and held by effort, on something not inherently gripping — as opposed to involuntary attention, which a loud noise or a bright screen grabs for free.",
        "William James's key claim: voluntary attention is trainable, and training it is foundational to character. This is why attention training is possible at all — and why the Return is a rep rather than a mood.",
      ],
      related: ["the-return", "anchor", "presence"],
      source: {
        label: "James, Principles of Psychology, Ch. XI (1890)",
        url: "https://psychclassics.yorku.ca/James/Principles/prin11.htm",
      },
    },
  ],
  resources: [
    {
      kind: "knowledge",
      title: "A Wandering Mind Is an Unhappy Mind — Killingsworth & Gilbert, Science (2010)",
      url: "https://pdodds.w3.uvm.edu/files/papers/others/2010/killingsworth2010a.pdf",
      note: "Landmark study: the mind is elsewhere ~47% of waking hours, and that wandering predicts unhappiness. The core motivation.",
    },
    {
      kind: "knowledge",
      title: "William James — The Principles of Psychology, Ch. XI “Attention” (1890)",
      url: "https://psychclassics.yorku.ca/James/Principles/prin11.htm",
      note: "Primary source. Voluntary vs involuntary attention; the Return as “the very root of character and will.”",
    },
    {
      kind: "knowledge",
      title: "The Marginalian — William James on Attention",
      url: "https://www.themarginalian.org/2016/03/25/william-james-attention/",
      note: "Accessible distillation of James. A gentle entry point before the primary text.",
    },
    {
      kind: "community",
      title: "The next conversation you have with a real person",
      note: "The only true test of present attention is with a live human. Apply every lesson immediately.",
    },
  ],
};
