"use client";

// Models tab: which Claude model answers each feature (models.json via /api/settings), with the
// measured speed and cost from calls.jsonl, the Steer live lab's text model (Haiku through the
// claude CLI, or any OpenRouter model), Watch's model and effort with what that pick gives (your videos'
// times and frames from your latest one), and the "Prefetch pictures" switch. Nothing is estimated:
// a model with no calls for a feature shows "not measured".

import { Fragment, useEffect, useState } from "react";
import "@/app/control/models.css";
import { LAB_CLAUDE_MODEL as CLAUDE_LAB, isLabModel } from "@/lib/spaceship";

type Model = "haiku" | "sonnet" | "opus";
const MODELS: Model[] = ["haiku", "sonnet", "opus"];
const NAME: Record<Model, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };
const FEATURES: { key: string; what: string }[] = [
  { key: "explain.1", what: "Canvas card · definition" },
  { key: "explain.2", what: "Canvas card · plain words" },
  { key: "explain.3", what: "Canvas card · how it works" },
  { key: "explain.4", what: "Canvas card · picture (SVG)" },
  { key: "ask.simple", what: "Reader tutor · simple" },
  { key: "ask.mid", what: "Reader tutor · mid" },
  { key: "ask.deep", what: "Reader tutor · deep" },
  { key: "warmup", what: "Warm-up questions from your gaps" },
  { key: "recall", what: "“Recall first?” question on a reused card" },
  { key: "gloss", what: "Lesson glossary · definitions as you highlight" },
];

// Watch has its own section: what an effort does to a video. Measured on Opus while building it; the times under it are yours.
type Effort = "low" | "medium" | "high";
const EFFORTS: Effort[] = ["low", "medium", "high"];
const EFFORT_DOES: Record<Effort, string> = {
  low: "Doesn’t think first. The first scene plays within seconds while the rest are written, but the pictures are uneven.",
  medium: "Thinks for about a minute before writing. The video plays once its whole script is written.",
  high: "Designs the whole video before it writes: the clearest pictures and the best-told story. The video plays once its whole script is written, a few minutes in.",
};

// The lab's ready picks. Any other OpenRouter model id can be typed in ("Other OpenRouter model").
const LAB_PICKS: { id: string; name: string }[] = [
  { id: CLAUDE_LAB, name: "Haiku 5.5 · claude CLI (your subscription)" },
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash · OpenRouter" },
  { id: "openai/gpt-oss-120b", name: "gpt-oss-120b · OpenRouter, on Cerebras" },
];
const OTHER = "other";
const labName = (m: string) => LAB_PICKS.find((p) => p.id === m)?.name.split(" · ")[0] ?? m;

type Stat = { n: number; first: number; total: number; cost: number };
type Settings = { models: Record<string, Model>; prefetchPictures: boolean; lab: string; watchEffort: Effort };
type WatchStat = { n: number; secs: number; latest: { course: string; id: string; term: string; scenes: number; secs: number } };
type Data = Settings & {
  measured: {
    days: number;
    stats: Record<string, Partial<Record<Model, Stat>>>;
    lab: Record<string, Stat>;
    pictures: { calls: number; cost: number };
    watch: Record<string, WatchStat>; // by "model|effort"
  };
};

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
// Under a tenth of a cent (an OpenRouter lab call, say) as two significant figures, so it doesn't show as $0.0000.
const mins = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`);
const usd = (x: number) => (x > 0 && x < 0.001 ? `$${x.toPrecision(2)}` : `$${x.toFixed(x < 0.01 ? 4 : x < 1 ? 3 : 2)}`);

export default function ModelsTab() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState("");
  const [pick, setPick] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [otherLab, setOtherLab] = useState(false); // "Other OpenRouter model" picked, so the id box shows even while it matches a pick

  useEffect(() => {
    fetch("/api/settings?measured=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Data) => {
        setData(d);
        setPick({ models: d.models, prefetchPictures: d.prefetchPictures, lab: d.lab, watchEffort: d.watchEffort });
        setOtherLab(!LAB_PICKS.some((p) => p.id === d.lab));
      })
      .catch((e: Error) => setFailed(e.message));
  }, []);

  if (failed) return <p className="ctl-muted">Couldn’t load the model settings ({failed}).</p>;
  if (!data || !pick) return <p className="ctl-muted">Loading…</p>;

  const { stats, days, pictures } = data.measured;
  const changed = [...FEATURES, { key: "watch" }].filter((f) => pick.models[f.key] !== data.models[f.key]);
  const effortChanged = pick.watchEffort !== data.watchEffort;
  const prefetchChanged = pick.prefetchPictures !== data.prefetchPictures;
  const labChanged = pick.lab !== data.lab;
  const labValid = isLabModel(pick.lab);
  const changes = [
    ...changed.map((f) => `${f.key} → ${NAME[pick.models[f.key]]}`),
    ...(prefetchChanged ? [`prefetch pictures ${pick.prefetchPictures ? "on" : "off"}`] : []),
    ...(labChanged ? [`lab → ${labName(pick.lab) || "(no model)"}`] : []),
    ...(effortChanged ? [`watch effort → ${pick.watchEffort}`] : []),
  ];

  const apply = async () => {
    setSaving(true);
    try {
      const body: Partial<Settings> = { models: Object.fromEntries(changed.map((f) => [f.key, pick.models[f.key]])) };
      if (prefetchChanged) body.prefetchPictures = pick.prefetchPictures;
      if (labChanged) body.lab = pick.lab;
      if (effortChanged) body.watchEffort = pick.watchEffort;
      const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
      const saved = (await r.json()) as Settings;
      setData({ ...data, ...saved });
      setPick(saved);
      setOtherLab(!LAB_PICKS.some((p) => p.id === saved.lab));
    } catch (e) {
      alert(`Couldn’t save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ctl-models">
      <p className="ctl-models-lede">
        Which model answers each feature. A change applies to the next call, no restart. Numbers are your measured
        medians over the last {days} days (list-price cost per call; on a subscription it isn’t billed per call).
      </p>
      <table className="ctl-models-table">
        <thead>
          <tr><th>Feature</th><th>Model</th><th>First words</th><th>Finished</th><th>Per call</th></tr>
        </thead>
        <tbody>
          {FEATURES.map((f) => {
            const m = pick.models[f.key];
            const s = stats[f.key]?.[m];
            const others = MODELS.filter((o) => o !== m);
            return (
              <Fragment key={f.key}>
                <tr className={`main${m !== data.models[f.key] ? " changed" : ""}`}>
                  <td className="feat"><code>{f.key}</code><small>{f.what}</small></td>
                  <td className="pick">
                    <select
                      value={m}
                      onChange={(e) => setPick({ ...pick, models: { ...pick.models, [f.key]: e.target.value as Model } })}
                      aria-label={`Model for ${f.key}`}
                    >
                      {MODELS.map((o) => <option key={o} value={o}>{NAME[o]}</option>)}
                    </select>
                  </td>
                  {s ? (
                    <>
                      <td data-label="First words">{sec(s.first)}</td>
                      <td data-label="Finished">{sec(s.total)}</td>
                      <td data-label="Per call">{usd(s.cost)} <small>{s.n} call{s.n > 1 ? "s" : ""}</small></td>
                    </>
                  ) : (
                    <td className="none" colSpan={3}>no data yet for {NAME[m]}</td>
                  )}
                </tr>
                <tr className={`cmp${m !== data.models[f.key] ? " changed" : ""}`}>
                  <td colSpan={5}>
                    {others.map((o) => {
                      const x = stats[f.key]?.[o];
                      return (
                        <span key={o}>
                          <b>{NAME[o]}</b>{" "}
                          {x ? `${sec(x.first)} · ${sec(x.total)} · ${usd(x.cost)} · ${x.n} call${x.n > 1 ? "s" : ""}` : "not measured"}
                        </span>
                      );
                    })}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <section className="ctl-models-lab ctl-models-watch">
        <h3>Watch · narrated video</h3>
        <p>
          The model that writes a video’s script and draws its frames when you press ▶ Watch on a highlight, and how hard it thinks
          before it starts. A change applies to the next video.
        </p>
        <div className={`ctl-models-labpick${changed.some((f) => f.key === "watch") || effortChanged ? " changed" : ""}`}>
          <select
            value={pick.models.watch}
            onChange={(e) => setPick({ ...pick, models: { ...pick.models, watch: e.target.value as Model } })}
            aria-label="Model for Watch"
          >
            {MODELS.map((o) => <option key={o} value={o}>{NAME[o]}</option>)}
          </select>
          <select value={pick.watchEffort} onChange={(e) => setPick({ ...pick, watchEffort: e.target.value as Effort })} aria-label="Effort for Watch">
            {EFFORTS.map((o) => <option key={o} value={o}>{o} effort</option>)}
          </select>
        </div>
        <div className="ctl-watch-effects">
          {(pick.models.watch !== data.models.watch || effortChanged) && (
            <WatchEffect label="Now" model={data.models.watch} effort={data.watchEffort} stat={data.measured.watch[`${data.models.watch}|${data.watchEffort}`]} />
          )}
          <WatchEffect
            label={pick.models.watch !== data.models.watch || effortChanged ? "Picked" : "Now"}
            model={pick.models.watch}
            effort={pick.watchEffort}
            stat={data.measured.watch[`${pick.models.watch}|${pick.watchEffort}`]}
          />
        </div>
      </section>

      <section className="ctl-models-lab">
        <h3>Steer live lab</h3>
        <p>
          The model that writes in the lab inside a note: its text, its keyword highlights and its dial menus. Haiku runs on your
          Claude subscription through the <code>claude</code> CLI; any other pick runs on OpenRouter with the key in{" "}
          <code>.env.local</code>, billed per call. A change applies to the next call.
        </p>
        <div className={`ctl-models-labpick${labChanged ? " changed" : ""}`}>
          <select
            value={otherLab ? OTHER : pick.lab}
            onChange={(e) => {
              const v = e.target.value;
              setOtherLab(v === OTHER);
              setPick({ ...pick, lab: v === OTHER ? "" : v });
            }}
            aria-label="Model for the Steer live lab"
          >
            {LAB_PICKS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value={OTHER}>Other OpenRouter model…</option>
          </select>
          {otherLab && (
            <input
              value={pick.lab}
              onChange={(e) => setPick({ ...pick, lab: e.target.value.trim() })}
              placeholder="vendor/model, as on openrouter.ai"
              aria-label="OpenRouter model id"
              aria-invalid={!labValid}
              spellCheck={false}
            />
          )}
        </div>
        {otherLab && !labValid && <p className="ctl-muted">An OpenRouter model id looks like <code>deepseek/deepseek-v4-flash</code>.</p>}
        <p className="ctl-muted">Measured over the last {days} days, medians per call:</p>
        <ul className="ctl-models-labstats">
          {Object.entries(data.measured.lab).length ? (
            Object.entries(data.measured.lab)
              .sort((a, b) => b[1].n - a[1].n)
              .map(([m, x]) => (
                <li key={m}>
                  <b>{labName(m)}</b> first words {sec(x.first)} · finished {sec(x.total)} · {usd(x.cost)} · {x.n} call{x.n > 1 ? "s" : ""}
                </li>
              ))
          ) : (
            <li className="ctl-muted">no lab calls yet</li>
          )}
        </ul>
      </section>

      <section className="ctl-models-prefetch">
        <button
          role="switch"
          aria-checked={pick.prefetchPictures}
          className={pick.prefetchPictures ? "on" : ""}
          onClick={() => setPick({ ...pick, prefetchPictures: !pick.prefetchPictures })}
        >
          <span aria-hidden="true" />
        </button>
        <div>
          <h3>Prefetch pictures</h3>
          <p>When on, a canvas card at “how it works” already draws its picture, so zooming in shows it at once; when off, the picture is drawn only when you zoom to it.</p>
          <p className="ctl-muted">
            Picture calls (<code>explain.4</code>) in the last {days} days: <b>{pictures.calls}</b>, {usd(pictures.cost)} at list price.
            That counts every picture, prefetched or zoomed to; the log can’t tell which prefetched pictures you later opened.
          </p>
        </div>
      </section>

      <div className="ctl-models-savebar">
        {changes.length ? (
          <>
            <span>{changes.length} change{changes.length > 1 ? "s" : ""}: {changes.join(", ")}</span>
            <button
              onClick={() => {
                setPick({ models: data.models, prefetchPictures: data.prefetchPictures, lab: data.lab, watchEffort: data.watchEffort });
                setOtherLab(!LAB_PICKS.some((p) => p.id === data.lab));
              }}
              disabled={saving}
            >
              Undo
            </button>
            <button className="primary" onClick={apply} disabled={saving || !labValid}>{saving ? "Saving…" : "Apply"}</button>
          </>
        ) : (
          <span className="ctl-muted">No pending changes.</span>
        )}
      </div>
    </div>
  );
}

/** What a Watch model and effort give: what the effort does, your videos' times with it, and the frames of your latest one. */
function WatchEffect({ label, model, effort, stat }: { label: string; model: Model; effort: Effort; stat?: WatchStat }) {
  const v = stat?.latest;
  const file = (name: string) => v && `/api/watch/file?course=${encodeURIComponent(v.course)}&id=${encodeURIComponent(v.id)}&name=${name}`;
  return (
    <div className="ctl-watch-effect">
      <h4><small>{label}</small> {NAME[model]} · {effort} effort</h4>
      <p>{EFFORT_DOES[effort]}</p>
      {stat && v ? (
        <>
          <p className="ctl-muted">
            Your {stat.n === 1 ? "one video" : `${stat.n} videos`} with it took {stat.n === 1 ? "" : "a median of "}<b>{mins(stat.secs)}</b> from
            ▶ Watch to the whole video. The latest, on “{v.term}”, {v.scenes} scenes:
          </p>
          <a className="ctl-watch-frames" href={file("video.mp4")} target="_blank" rel="noreferrer" title="Play this video">
            {Array.from({ length: Math.min(4, v.scenes) }, (_, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={file(`scene-${i + 1}.svg`)} alt={`Scene ${i + 1}`} loading="lazy" />
            ))}
          </a>
        </>
      ) : (
        <p className="ctl-muted">No video made with {NAME[model]} at {effort} effort in the last 30 days. Apply it and press ▶ Watch on a highlight; your video shows here.</p>
      )}
    </div>
  );
}
