/**
 * Size of the #1 frame on the Fire board.
 *
 * Width and height are already on the payload, so the frame can be laid out before
 * the file arrives. Without that, the board paints as an even list and jumps when
 * the winning photo loads.
 */
export function topFireFrameStyle(width?: number, height?: number): {
  display: "block";
  width: "100%";
  position: "relative";
  overflow: "hidden";
  aspectRatio: string;
  maxHeight: "60svh";
  height: string;
} {
  const w = width && height && width > 0 && height > 0 ? width : 4;
  const h = width && height && width > 0 && height > 0 ? height : 3;
  return {
    display: "block",
    width: "100%",
    position: "relative",
    overflow: "hidden",
    aspectRatio: `${w} / ${h}`,
    // svh, not dvh: the browser chrome hiding at the end of a scroll must not
    // grow the winner and shove the rest of the board.
    maxHeight: "60svh",
    // cqw is the board's width (the parent is a container), so this does not wait on the image.
    height: `min(60svh, calc(100cqw * ${h} / ${w}))`,
  };
}
