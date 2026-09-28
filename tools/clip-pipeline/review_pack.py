#!/usr/bin/env python3
"""Build the clip review pack: one HTML page a human can approve a batch from.

The batch docs in `clips/<date>/strategy.md` are the working record. This is the
thing you hand to the person whose approval you need -- it carries a frame from
every clip, so a reviewer can see what they are signing off rather than reading
filenames.

Design follows DESIGN.md: Void Black ground, Warm Amber as the only accent, the
real Cehua Free display face inlined, Liberation Sans (Arimo) for text.

    review_pack.py --posters posters.json --out review.html
"""
import argparse
import base64
import html
import json
from datetime import timedelta
from pathlib import Path

import library
import tags as TAGS

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
FONT = PROJECT_ROOT / "site" / "public" / "legacy" / "fonts" / "CehuaFree.otf"

STREAM_TITLES = {
    "2026-06-26": "Just Chatting",
    "2026-07-03": "Live Session w/ Tresor",
    "2026-07-08": "Live Session w/ Kiki Rowe",
}


def hhmmss(seconds):
    td = timedelta(seconds=int(seconds))
    h, m, s = td.seconds // 3600, (td.seconds // 60) % 60, td.seconds % 60
    return f"{h}:{m:02d}:{s:02d}"


def css(font_b64):
    face = (f"@font-face{{font-family:'Cehua';src:url(data:font/otf;base64,{font_b64})"
            " format('opentype');font-weight:400;font-display:swap;}") if font_b64 else ""
    return face + """
:root{
  --ground:#FAF8F5; --panel:#FFFFFF; --sunk:#F1EDE6;
  --ink:#141210; --ink-2:#4A443D; --muted:#8A8A8A;
  --rule:rgba(126,43,12,.18); --rule-strong:rgba(126,43,12,.34);
  --amber:#BC4803; --amber-bright:#F58804; --gold:#A87F00;
  --shadow:0 1px 2px rgba(20,18,16,.06), 0 8px 24px rgba(20,18,16,.05);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ground:#000000; --panel:#141414; --sunk:#0B0B0B;
    --ink:#F4E3C6; --ink-2:#D9D2C6; --muted:#8A8A8A;
    --rule:rgba(244,227,198,.12); --rule-strong:rgba(245,136,4,.42);
    --amber:#F58804; --amber-bright:#F58804; --gold:#FFDE00;
    --shadow:none;
  }
}
:root[data-theme="dark"]{
  --ground:#000000; --panel:#141414; --sunk:#0B0B0B;
  --ink:#F4E3C6; --ink-2:#D9D2C6; --muted:#8A8A8A;
  --rule:rgba(244,227,198,.12); --rule-strong:rgba(245,136,4,.42);
  --amber:#F58804; --amber-bright:#F58804; --gold:#FFDE00;
  --shadow:none;
}
*{box-sizing:border-box;}
body{
  margin:0; background:var(--ground); color:var(--ink-2);
  font-family:Arimo,"Liberation Sans",Helvetica,Arial,sans-serif;
  font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1120px; margin:0 auto; padding:56px 24px 96px;}
h1,h2,h3{color:var(--ink); text-wrap:balance; margin:0;}
h1{font-family:Cehua,Georgia,"Times New Roman",serif; font-size:clamp(38px,6vw,60px);
   line-height:1.02; letter-spacing:-.01em; font-weight:400;}
.lede{max-width:62ch; margin-top:14px; font-size:17px; color:var(--ink-2);}
.eyebrow{font-size:11px; letter-spacing:.16em; text-transform:uppercase;
  color:var(--muted); font-family:"Roboto Mono",ui-monospace,monospace;}

/* summary */
.summary{display:flex; flex-wrap:wrap; gap:10px; margin:28px 0 8px;}
.stat{background:var(--panel); border:1px solid var(--rule); border-radius:2px;
  padding:12px 16px; box-shadow:var(--shadow); min-width:132px;}
.stat b{display:block; font-family:"Roboto Mono",ui-monospace,monospace;
  font-variant-numeric:tabular-nums; font-size:26px; color:var(--ink); line-height:1.1;}
.stat span{font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted);}

.note{border-left:2px solid var(--amber); padding:2px 0 2px 16px; margin:34px 0 0;
  max-width:66ch; color:var(--ink-2);}
.note b{color:var(--ink);}

/* stream section */
section{margin-top:64px;}
.shead{display:flex; align-items:baseline; gap:14px; flex-wrap:wrap;
  border-bottom:1px solid var(--rule-strong); padding-bottom:12px;}
.shead h2{font-family:Cehua,Georgia,serif; font-weight:400; font-size:30px; letter-spacing:-.01em;}
.shead .date{font-family:"Roboto Mono",ui-monospace,monospace; font-size:13px; color:var(--amber);}
.shead .count{margin-left:auto; font-size:12px; color:var(--muted);
  font-family:"Roboto Mono",ui-monospace,monospace;}

/* where the clips fall across the stream */
.timeline{position:relative; height:26px; margin:16px 0 26px;}
.timeline .track{position:absolute; top:12px; left:0; right:0; height:1px; background:var(--rule-strong);}
.timeline .tick{position:absolute; top:6px; width:2px; height:13px; background:var(--amber);}
.timeline .tl-label{position:absolute; top:0; font-size:10px; color:var(--muted);
  font-family:"Roboto Mono",ui-monospace,monospace;}
.timeline .tl-end{right:0;}

/* clip rows */
.clip{display:grid; grid-template-columns:112px 1fr; gap:20px; padding:22px 0;
  border-bottom:1px solid var(--rule);}
.clip:last-child{border-bottom:none;}
.poster{position:relative; border-radius:2px; overflow:hidden; background:var(--sunk);
  border:1px solid var(--rule); aspect-ratio:9/16;}
.poster img{width:100%; height:100%; object-fit:cover; display:block;}
.poster .num{position:absolute; top:0; left:0; background:var(--amber); color:#000;
  font-family:"Roboto Mono",ui-monospace,monospace; font-size:11px; font-weight:700;
  padding:2px 7px; letter-spacing:.04em;}
.meta{display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:10px;}
.tc{font-family:"Roboto Mono",ui-monospace,monospace; font-variant-numeric:tabular-nums;
  font-size:13px; color:var(--amber);}
.chip{font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; padding:3px 8px;
  border:1px solid var(--rule-strong); border-radius:999px; color:var(--ink-2);}
.chip.tag{border-color:var(--amber); color:var(--amber);}
.chip.state{margin-left:auto; border-style:dashed;}
.hook{font-family:Cehua,Georgia,serif; font-size:23px; line-height:1.2; color:var(--ink);
  letter-spacing:-.005em; margin:0 0 6px;}
.alt{font-size:14px; color:var(--muted); margin:0 0 12px;}
.alt em{font-style:normal; color:var(--ink-2);}
.said{font-size:13.5px; color:var(--ink-2); background:var(--sunk); border:1px solid var(--rule);
  border-radius:2px; padding:10px 13px; margin:0 0 12px; max-width:72ch;}
.said span{display:block; font-size:10px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--muted); margin-bottom:5px; font-family:"Roboto Mono",ui-monospace,monospace;}
details.caption{border:1px solid var(--rule); border-radius:2px; background:var(--panel);}
details.caption summary{cursor:pointer; padding:9px 13px; font-size:12px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--muted); font-family:"Roboto Mono",ui-monospace,monospace;}
details.caption summary:hover{color:var(--amber);}
details.caption[open] summary{border-bottom:1px solid var(--rule);}
.capbody{padding:13px; white-space:pre-wrap; font-size:14px; color:var(--ink-2);}
button.copy{margin:0 13px 13px; background:transparent; border:1px solid var(--amber);
  color:var(--amber); font:inherit; font-size:12px; padding:6px 14px; border-radius:2px;
  cursor:pointer;}
button.copy:hover{background:var(--amber); color:var(--ground);}
button.copy:focus-visible, summary:focus-visible{outline:2px solid var(--amber-bright); outline-offset:2px;}
footer{margin-top:72px; padding-top:22px; border-top:1px solid var(--rule);
  font-size:13px; color:var(--muted);}
code{font-family:"Roboto Mono",ui-monospace,monospace; font-size:.9em; color:var(--ink-2);}
@media (max-width:640px){
  .clip{grid-template-columns:84px 1fr; gap:14px;}
  .hook{font-size:19px;}
}
@media (prefers-reduced-motion:reduce){*{transition:none !important; animation:none !important;}}
"""


def render(data, posters, title):
    clips = library.clips(data)
    by_date = {}
    for c in clips:
        by_date.setdefault(c["date"], []).append(c)

    font_b64 = base64.b64encode(FONT.read_bytes()).decode("ascii") if FONT.exists() else ""
    total_secs = sum(c["duration"] for c in clips)
    approved = sum(1 for c in clips if c.get("status") == "approved")

    out = [
        f"<title>{html.escape(title)}</title>",
        '<link rel="preconnect" href="https://fonts.googleapis.com">',
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
        'family=Arimo:wght@400;700&family=Roboto+Mono:wght@400;500&display=swap">',
        f"<style>{css(font_b64)}</style>",
        '<div class="wrap">',
        '<p class="eyebrow">Yanchan Produced &middot; clip batch for approval</p>',
        f"<h1>{html.escape(title)}</h1>",
        '<p class="lede">Every clip below is finished and postable as it stands: 1080&times;1920, '
        'burned-in captions, logo, audio levelled to broadcast loudness. Nothing has been '
        'published. Pick the ones you want out and say which numbers.</p>',
        '<div class="summary">',
        f'<div class="stat"><b>{len(clips)}</b><span>clips ready</span></div>',
        f'<div class="stat"><b>{total_secs/60:.0f}</b><span>minutes of video</span></div>',
        f'<div class="stat"><b>{len(by_date)}</b><span>streams mined</span></div>',
        f'<div class="stat"><b>{approved}</b><span>approved so far</span></div>',
        "</div>",
        '<p class="note"><b>How to approve:</b> reply with the clip numbers you want '
        '(e.g. &ldquo;06-26: 1, 4, 7&rdquo;), or open the dashboard at '
        '<code>/dashboard</code> and set each clip&rsquo;s status there. '
        'Anything you reject stays on disk, it just never gets posted.</p>',
    ]

    for date in sorted(by_date, reverse=True):
        cs = by_date[date]
        stream_dur = next((c.get("stream_duration") for c in cs if c.get("stream_duration")), None)
        out.append("<section>")
        out.append('<div class="shead">'
                   f'<h2>{html.escape(STREAM_TITLES.get(date, "Stream"))}</h2>'
                   f'<span class="date">{date}</span>'
                   f'<span class="count">{len(cs)} clips &middot; '
                   f'{sum(c["duration"] for c in cs)/60:.1f} min</span></div>')

        if stream_dur:
            ticks = "".join(
                f'<div class="tick" style="left:{100*c["start"]/stream_dur:.2f}%"></div>'
                for c in cs)
            out.append('<div class="timeline"><div class="track"></div>'
                       f'{ticks}<div class="tl-label">0:00</div>'
                       f'<div class="tl-label tl-end">{hhmmss(stream_dur)}</div></div>')

        for i, c in enumerate(cs, 1):
            h1_, h2_ = TAGS.hooks(c["context_tag"])
            hook = library.hook_for(c, h1_)
            alt = library.alt_for(c, h2_)
            caption = (c.get("copy") or {}).get("caption", "")
            poster_b64 = posters.get(c["path"], "")
            img = (f'<img src="data:image/jpeg;base64,{poster_b64}" alt="Frame from '
                   f'the clip at {hhmmss(c["start"])}">' if poster_b64 else "")
            layout = "two-pane" if c.get("mode") == "split" else "single-pane"
            out.append('<div class="clip">')
            out.append(f'<div class="poster">{img}<div class="num">{i:02d}</div></div>')
            out.append("<div>")
            out.append('<div class="meta">'
                       f'<span class="tc">{hhmmss(c["start"])}</span>'
                       f'<span class="chip tag">{html.escape(c["context_tag"])}</span>'
                       f'<span class="chip">{c["duration"]:.0f}s</span>'
                       f'<span class="chip">{layout}</span>'
                       f'<span class="chip state">{html.escape(c.get("status", "new"))}</span>'
                       "</div>")
            out.append(f'<p class="hook">{html.escape(hook)}</p>')
            out.append(f'<p class="alt">Alt: <em>{html.escape(alt)}</em></p>')
            if c.get("excerpt"):
                out.append('<div class="said"><span>What you hear</span>'
                           f'{html.escape(c["excerpt"])}</div>')
            if caption:
                cid = f"cap{date.replace('-', '')}{i}"
                out.append(
                    '<details class="caption"><summary>Ready-to-post caption</summary>'
                    f'<div class="capbody" id="{cid}">{html.escape(caption)}</div>'
                    f'<button class="copy" data-target="{cid}">Copy caption</button>'
                    "</details>")
            out.append("</div></div>")
        out.append("</section>")

    out.append('<footer>Files live in <code>clips/&lt;date&gt;/</code>. '
               'The record of every clip, its copy and its status is '
               '<code>clips/library.json</code>. Re-running the pipeline refreshes the '
               'clips and leaves approvals and copy alone.</footer>')
    out.append("</div>")
    out.append("""<script>
document.querySelectorAll('button.copy').forEach(function(b){
  b.addEventListener('click', function(){
    var el = document.getElementById(b.dataset.target);
    navigator.clipboard.writeText(el.innerText).then(function(){
      var was = b.textContent; b.textContent = 'Copied';
      setTimeout(function(){ b.textContent = was; }, 1400);
    });
  });
});
</script>""")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--posters", type=Path, help="posters.py output")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--title", default="Clip Batch for Approval")
    args = ap.parse_args()

    posters = json.loads(args.posters.read_text()) if args.posters and args.posters.exists() else {}
    args.out.write_text(render(library.load(), posters, args.title))
    print(f"Review pack -> {args.out} ({args.out.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
