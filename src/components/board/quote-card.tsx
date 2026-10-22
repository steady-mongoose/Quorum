import { useEffect, useId, useRef, useState } from "react";
import { btnGhost, btnQuiet, btnSignal } from "@/components/quorum/bits";
import {
  QUOTE_HOLD_MS,
  QUOTE_MOVE_PX,
  publicQuote,
  quoteCardLines,
  quoteCardSize,
  type PublicQuote,
} from "@/lib/board/quote";

const GOLD = "#c9a45c";
const INK = "#f0e7d3";
const MUTED = "#bcae94";
const ACCENT = "#b4483e";

/**
 * Long-press the quotation, or use "Make a quote card". The card cites the
 * work. It does not name the member who posted it.
 */
export function QuotePassage({
  claim,
  reason,
  author,
}: {
  claim: string;
  reason: string;
  author: string;
}) {
  const quote = publicQuote({ claim, reason, author });
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };

  useEffect(() => clear, []);

  return (
    <>
      <p
        className="mt-2 max-w-prose text-base text-fg"
        onPointerDown={(event) => {
          if (!quote || event.button !== 0) return;
          origin.current = { x: event.clientX, y: event.clientY };
          clear();
          origin.current = { x: event.clientX, y: event.clientY };
          timer.current = window.setTimeout(() => {
            timer.current = null;
            setOpen(true);
          }, QUOTE_HOLD_MS);
        }}
        onPointerMove={(event) => {
          if (!origin.current) return;
          const dx = event.clientX - origin.current.x;
          const dy = event.clientY - origin.current.y;
          if (Math.hypot(dx, dy) > QUOTE_MOVE_PX) clear();
        }}
        onPointerUp={clear}
        onPointerCancel={clear}
      >
        {claim}
      </p>
      {quote ? (
        <button type="button" className={`${btnQuiet} px-0`} onClick={() => setOpen(true)}>
          Make a quote card
        </button>
      ) : null}
      {open && quote ? <QuoteDialog quote={quote} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function QuoteDialog({ quote, onClose }: { quote: PublicQuote; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const titleId = useId();
  const [image, setImage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const size = quoteCardSize(quote.words);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    closeRef.current?.focus();
    let cancelled = false;
    void paintQuote(quote).then((url) => {
      if (!cancelled) setImage(url);
    });
    return () => {
      cancelled = true;
      if (!dialog.open) return;
      closing.current = true;
      dialog.close();
    };
  }, [quote.text, quote.author, quote.work]);

  const share = async () => {
    if (!image) return;
    const blob = await (await fetch(image)).blob();
    const file = new File([blob], "avouch-quote.png", { type: "image/png" });
    const payload = { files: [file], title: quote.work };
    const canShare = navigator.canShare?.(payload) && typeof navigator.share === "function";
    if (canShare && navigator.share) {
      try {
        await navigator.share(payload);
        setNote("Quote card ready");
      } catch {
        // The reader closed the sheet. Do not also download.
      }
      return;
    }
    const link = document.createElement("a");
    link.href = image;
    link.download = "avouch-quote.png";
    link.click();
    setNote("Quote card ready");
  };

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={titleId}
      className="w-[min(28rem,calc(100%-2rem))] rounded-lg border border-line bg-surface p-5 text-fg backdrop:bg-bg/80"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (closing.current) {
          closing.current = false;
          return;
        }
        onClose();
      }}
    >
      <h2 id={titleId} className="font-display text-2xl text-fg">
        Quote card
      </h2>
      <p className="mt-2 text-sm text-muted">
        {quote.author}, {quote.work}. The card names the work, not the person who posted it.
      </p>
      {image ? (
        <img
          className="mt-4 w-full rounded-md border border-line"
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
          src={image}
          width={size.width}
          height={size.height}
          alt={`${quote.text} ${quote.author}, ${quote.work}`}
        />
      ) : (
        <div
          className="mt-4 w-full rounded-md bg-bg"
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
        />
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={btnSignal} onClick={() => void share()}>
          Share quote card
        </button>
        <button ref={closeRef} type="button" className={btnGhost} onClick={onClose}>
          Close
        </button>
      </div>
      {note ? (
        <p className="mt-2 text-sm text-muted" role="status">
          {note}
        </p>
      ) : null}
    </dialog>
  );
}

async function paintQuote(quote: PublicQuote): Promise<string> {
  const size = quoteCardSize(quote.words);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  await document.fonts.load(`500 ${size.height === 1080 ? 56 : 48}px "EB Garamond"`);
  await document.fonts.load(`italic 28px "EB Garamond"`);
  drawQuoteCard(ctx, quote, size);
  return canvas.toDataURL("image/png");
}

function drawQuoteCard(
  ctx: CanvasRenderingContext2D,
  quote: PublicQuote,
  size: { width: number; height: number },
) {
  const { width, height } = size;
  const lines = quoteCardLines(quote);
  const gradient = ctx.createRadialGradient(width / 2, 0, 40, width / 2, height * 0.15, width);
  gradient.addColorStop(0, "#2d251c");
  gradient.addColorStop(0.72, "#14100c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(201,164,92,0.45)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(44, 44, width - 88, height - 88);
  ctx.strokeRect(54, 54, width - 108, height - 108);
  drawCorner(ctx, 22, 22, 1, 1);
  drawCorner(ctx, width - 22, 22, -1, 1);
  drawCorner(ctx, 22, height - 22, 1, -1);
  drawCorner(ctx, width - 22, height - 22, -1, -1);

  const fontSize = height === 1080 ? 56 : 48;
  const textBottom = drawPassage(ctx, lines[0], 130, height === 1080 ? 200 : 220, width - 260, fontSize);
  drawOrnament(ctx, width / 2, textBottom + 36);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = INK;
  ctx.font = `500 34px "EB Garamond", Georgia, serif`;
  ctx.letterSpacing = "0.12em";
  ctx.fillText(lines[1].toUpperCase(), 130, textBottom + 80);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = MUTED;
  ctx.font = `italic 28px "EB Garamond", Georgia, serif`;
  wrapFill(ctx, lines[2], 130, textBottom + 128, width - 260, 36);
  ctx.fillStyle = MUTED;
  ctx.font = `500 22px "EB Garamond", Georgia, serif`;
  ctx.letterSpacing = "0.22em";
  ctx.textAlign = "center";
  ctx.fillText(lines[3].toUpperCase(), width / 2, height - 96);
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";
}

function drawPassage(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
): number {
  const first = text.slice(0, 1);
  const rest = text.slice(1).trimStart();
  const capSize = Math.round(fontSize * 3.1);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = ACCENT;
  ctx.font = `500 ${capSize}px "EB Garamond", Georgia, serif`;
  ctx.fillText(first, x, y);
  const capWidth = ctx.measureText(first).width + 18;
  const capHeight = capSize * 0.78;
  ctx.fillStyle = INK;
  ctx.font = `400 ${fontSize}px "EB Garamond", Georgia, serif`;
  const beside = wrap(ctx, rest, maxWidth - capWidth);
  let cursor = y + 12;
  let index = 0;
  while (index < beside.length && cursor + fontSize < y + capHeight) {
    ctx.fillText(beside[index], x + capWidth, cursor);
    cursor += fontSize * 1.28;
    index += 1;
  }
  let bottom = Math.max(cursor, y + capHeight);
  if (index < beside.length) {
    const leftover = wrap(ctx, beside.slice(index).join(" "), maxWidth);
    for (const line of leftover) {
      ctx.fillText(line, x, bottom);
      bottom += fontSize * 1.28;
    }
  }
  return bottom;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(trial).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wrapFill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  for (const line of wrap(ctx, text, maxWidth)) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
}

function drawOrnament(ctx: CanvasRenderingContext2D, cx: number, y: number) {
  ctx.strokeStyle = GOLD;
  ctx.fillStyle = GOLD;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 120, y);
  ctx.lineTo(cx - 16, y);
  ctx.moveTo(cx + 16, y);
  ctx.lineTo(cx + 120, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, y - 7);
  ctx.lineTo(cx + 7, y);
  ctx.lineTo(cx, y + 7);
  ctx.lineTo(cx - 7, y);
  ctx.closePath();
  ctx.stroke();
}

function drawCorner(ctx: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(4, 56);
  ctx.lineTo(4, 4);
  ctx.lineTo(56, 4);
  ctx.moveTo(10, 50);
  ctx.lineTo(10, 10);
  ctx.lineTo(50, 10);
  ctx.moveTo(4, 4);
  ctx.lineTo(16, 16);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(18, 18, 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
