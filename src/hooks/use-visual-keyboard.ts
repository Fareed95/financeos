import { useEffect, useState } from "react";

/** Pixels covered by the on-screen keyboard (visualViewport). */
export function useVisualKeyboard() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const next = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty("--kb-inset", `${next}px`);
      document.documentElement.classList.toggle("fos-kb-open", next > 80);
      setInset(next);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.documentElement.style.removeProperty("--kb-inset");
      document.documentElement.classList.remove("fos-kb-open");
    };
  }, []);

  return inset;
}
