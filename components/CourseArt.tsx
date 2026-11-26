// Cut-paper cover art for a course, drawn as inline SVG. Each known course gets
// its own motif; any other slug gets an abstract composition seeded from the slug.
// The art is a "print", so its colours are fixed and do not follow dark mode.

const P = {
  sheet: "#f1ecdf", // cream backing paper
  white: "#fbf9f3",
  ink: "#19221f",
  blue: "#234be7",
  lime: "#ddf59e",
  coral: "#e0664f",
  sage: "#b9c8b4",
  sand: "#e3d6b8",
  green: "#1f7a4d",
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Motif = (cut: string) => React.ReactNode;

// A grid of weights on stacked sheets, a vector going in.
const mlModels: Motif = (cut) => {
  const cols = 7, rows = 5, s = 46;
  const hot: Record<string, string> = { "1-1": P.blue, "4-0": P.coral, "2-3": P.blue, "5-2": P.lime, "0-4": P.coral, "6-4": P.blue, "3-2": P.ink };
  return (
    <>
      <g filter={cut} transform="rotate(-7 520 250)">
        <rect x="300" y="110" width="400" height="300" fill={P.sage} />
      </g>
      <g filter={cut} transform="rotate(4 500 260)">
        <rect x="270" y="120" width="400" height="300" fill={P.sand} />
      </g>
      <g filter={cut} transform="rotate(-2 480 270)">
        <rect x="250" y="130" width={cols * s + 40} height={rows * s + 40} fill={P.white} />
        {Array.from({ length: cols * rows }, (_, i) => {
          const c = i % cols, r = Math.floor(i / cols);
          return (
            <rect key={i} x={270 + c * s + 3} y={150 + r * s + 3} width={s - 6} height={s - 6}
              fill={hot[`${c}-${r}`] ?? "none"} stroke={P.ink} strokeOpacity="0.28" strokeWidth="1.5" />
          );
        })}
      </g>
      <g filter={cut} transform="rotate(3 150 270)">
        <rect x="118" y="150" width="62" height="250" fill={P.blue} />
        {[0, 1, 2, 3, 4].map((i) => (
          <circle key={i} cx="149" cy={180 + i * 47} r="13" fill={i === 2 ? P.lime : P.white} />
        ))}
      </g>
      <g filter={cut}>
        <path d="M196 262 h34 v-14 l26 24 -26 24 v-14 h-34z" fill={P.ink} />
      </g>
    </>
  );
};

// A paper phone with the eval loop turning around it.
const day31: Motif = (cut) => (
  <>
    <g filter={cut}>
      <path d="M400 60 a200 200 0 1 1 -173 100" fill="none" stroke={P.sage} strokeWidth="46" />
    </g>
    <g filter={cut}>
      <path d="M200 110 l70 6 -42 58z" fill={P.sage} />
    </g>
    <g filter={cut} transform="rotate(-6 400 260)">
      <rect x="305" y="70" width="190" height="380" rx="26" fill={P.ink} />
      <rect x="320" y="100" width="160" height="310" rx="6" fill={P.white} />
      <rect x="336" y="122" width="96" height="26" rx="13" fill={P.sand} />
      <rect x="368" y="160" width="96" height="40" rx="14" fill={P.blue} />
      <rect x="336" y="212" width="112" height="26" rx="13" fill={P.sand} />
      {[52, 86, 40, 70].map((h, i) => (
        <rect key={i} x={340 + i * 32} y={390 - h} width="22" height={h} fill={i === 1 ? P.coral : P.lime} stroke={P.ink} strokeOpacity="0.2" />
      ))}
    </g>
    <g filter={cut} transform="rotate(8 610 150)">
      <circle cx="610" cy="150" r="46" fill={P.coral} />
      <path d="M588 150 l16 16 30 -34" fill="none" stroke={P.white} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <g filter={cut} transform="rotate(-10 180 380)">
      <rect x="120" y="350" width="120" height="60" fill={P.lime} />
      <path d="M138 372 h84 M138 390 h56" stroke={P.ink} strokeWidth="5" strokeOpacity="0.55" />
    </g>
  </>
);

// Token tiles streaming into stacked layers, next-token bars coming out.
const howLlms: Motif = (cut) => {
  const tiles = [
    [70, 150, 86, P.white, -8], [110, 235, 64, P.lime, 5], [60, 310, 100, P.white, -3],
    [190, 190, 70, P.sand, 9], [200, 285, 58, P.blue, -6],
  ] as const;
  return (
    <>
      {tiles.map(([x, y, w, f, rot], i) => (
        <g key={i} filter={cut} transform={`rotate(${rot} ${x + w / 2} ${y + 22})`}>
          <rect x={x} y={y} width={w} height="44" rx="4" fill={f} />
          <path d={`M${x + 12} ${y + 22} h${w - 24}`} stroke={f === P.blue ? P.white : P.ink} strokeOpacity="0.5" strokeWidth="5" strokeLinecap="round" />
        </g>
      ))}
      {[0, 1, 2, 3].map((i) => (
        <g key={i} filter={cut} transform={`rotate(${[-3, 2, -1, 3][i]} 420 ${150 + i * 70})`}>
          <rect x="310" y={120 + i * 70} width="220" height="56" fill={[P.sage, P.white, P.sand, P.ink][i]} />
          {[0, 1, 2, 3, 4].map((j) => (
            <circle key={j} cx={340 + j * 40} cy={148 + i * 70} r="9" fill={i === 3 ? P.lime : (i + j) % 3 === 0 ? P.blue : P.ink} fillOpacity={i === 3 ? 1 : 0.75} />
          ))}
        </g>
      ))}
      <g filter={cut} transform="rotate(2 660 270)">
        <rect x="580" y="120" width="170" height="290" fill={P.white} />
        {[130, 74, 46, 28, 16].map((w, i) => (
          <rect key={i} x="598" y={146 + i * 50} width={w} height="30" fill={i === 0 ? P.coral : P.blue} fillOpacity={i === 0 ? 1 : 0.8 - i * 0.12} />
        ))}
      </g>
    </>
  );
};

// The edit lab: protected keys, the target key, the edit, and the untouched line.
const modelEditing: Motif = (cut) => (
  <>
    <g filter={cut} transform="rotate(-3 330 270)">
      <rect x="90" y="70" width="470" height="390" fill={P.white} />
      <path d="M120 400 H530 M180 100 V430" stroke={P.ink} strokeOpacity="0.3" strokeWidth="2" />
      <path d="M100 440 L540 250" stroke={P.green} strokeWidth="5" strokeDasharray="14 12" />
    </g>
    {[[420, 318, 20], [455, 290, 16], [398, 292, 15], [470, 326, 18], [436, 262, 14], [492, 296, 13]].map(([x, y, r], i) => (
      <g key={i} filter={cut}>
        <circle cx={x} cy={y} r={r} fill={P.coral} />
      </g>
    ))}
    <g filter={cut}>
      <path d="M180 400 L372 170 l-8 44 M372 170 l-42 14" fill="none" stroke={P.blue} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <g filter={cut}>
      <path d="M180 400 L112 148 l-18 40 M112 148 l34 26" fill="none" stroke={P.ink} strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <g filter={cut} transform="rotate(5 660 260)">
      <rect x="590" y="90" width="150" height="340" fill={P.sand} />
      {Array.from({ length: 40 }, (_, i) => {
        const c = i % 5, r = Math.floor(i / 5);
        return (
          <rect key={i} x={602 + c * 26} y={104 + r * 40} width="20" height="34"
            fill={c === 1 || c === 3 ? P.blue : P.white} fillOpacity={c === 1 || c === 3 ? 0.55 + ((r * 7 + c) % 4) * 0.15 : 0.85} />
        );
      })}
    </g>
    <g filter={cut} transform="rotate(-8 640 440)">
      <rect x="560" y="418" width="150" height="46" fill={P.lime} />
      <path d="M578 441 h114" stroke={P.ink} strokeWidth="5" strokeOpacity="0.6" strokeDasharray="22 10" />
    </g>
  </>
);

// Rings of focus, and the arc that returns to centre.
const attention: Motif = (cut) => (
  <>
    {[210, 160, 112, 66].map((r, i) => (
      <g key={i} filter={cut}>
        <circle cx="400" cy="270" r={r} fill={[P.sage, P.sand, P.white, P.blue][i]} />
      </g>
    ))}
    <g filter={cut}>
      <circle cx="400" cy="270" r="24" fill={P.lime} />
    </g>
    <g filter={cut}>
      <path d="M690 120 C610 60 520 120 452 226 l-4 -44 M452 226 l42 -10" fill="none" stroke={P.coral} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <g filter={cut} transform="rotate(12 130 400)">
      <rect x="80" y="372" width="110" height="56" fill={P.ink} />
    </g>
  </>
);

const MOTIFS: Record<string, Motif> = {
  "ml-models": mlModels,
  "day31-local-ai": day31,
  "how-llms-work": howLlms,
  "model-editing": modelEditing,
  attention,
};

function abstract(slug: string): Motif {
  return function AbstractMotif(cut) {
    const r = rng(hash(slug));
    const fills = [P.sage, P.sand, P.white, P.blue, P.coral, P.lime, P.ink];
    return (
      <>
        {Array.from({ length: 9 }, (_, i) => {
          const x = 90 + r() * 560, y = 70 + r() * 320, w = 70 + r() * 190, h = 50 + r() * 170;
          const fill = fills[Math.floor(r() * fills.length)], rot = (r() - 0.5) * 30;
          return (
            <g key={i} filter={cut} transform={`rotate(${rot} ${x + w / 2} ${y + h / 2})`}>
              {r() < 0.35 ? <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} fill={fill} /> : <rect x={x} y={y} width={w} height={h} fill={fill} />}
            </g>
          );
        })}
      </>
    );
  };
}

export default function CourseArt({ slug, title }: { slug: string; title: string }) {
  const id = `art-${slug.replace(/[^a-z0-9]/gi, "")}`;
  const motif = MOTIFS[slug] ?? abstract(slug);
  return (
    <svg className="course-art" viewBox="0 0 800 520" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Cut-paper illustration for ${title}`}>
      <defs>
        {/* paper grain: fibre noise lit from the top-left */}
        <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed={hash(slug) % 97} result="n" />
          <feDiffuseLighting in="n" lightingColor="#fff" surfaceScale="1.1" result="lit">
            <feDistantLight azimuth="225" elevation="62" />
          </feDiffuseLighting>
          <feComposite in="lit" in2="SourceGraphic" operator="in" />
        </filter>
        {/* a cut sheet: slightly ragged edge, soft shadow underneath */}
        <filter id={`${id}-cut`} x="-10%" y="-10%" width="120%" height="125%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed={hash(slug) % 53} result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale="5" result="edge" />
          <feDropShadow in="edge" dx="2" dy="5" stdDeviation="4" floodColor="#19221f" floodOpacity="0.28" />
        </filter>
      </defs>
      <rect width="800" height="520" fill={P.sheet} />
      {motif(`url(#${id}-cut)`)}
      <rect width="800" height="520" fill="#fff" filter={`url(#${id}-grain)`} opacity="0.5" style={{ mixBlendMode: "multiply" }} />
    </svg>
  );
}
