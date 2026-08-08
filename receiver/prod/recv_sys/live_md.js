/**
 * Receiver markdown — pretty PRINT for paper (pocket-notebook lineage).
 * Edit in the terminal; paper peeks. data-line=N for scroll sync.
 */
(() => {
  "use strict";

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMdInline(raw) {
    let s = esc(raw);
    // Protect whole spans (content + tags) so * _ ~~ etc. never touch code.
    const slots = [];
    function stash(html) {
      slots.push(html);
      return "\u0000S" + (slots.length - 1) + "\u0000";
    }
    // single-tick inline code first — literal asterisks, underscores, etc.
    s = s.replace(/`([^`\n]+)`/g, (_, code) =>
      stash('<code class="pn-code">' + code + "</code>")
    );
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\+\+(.+?)\+\+/g, "<u>$1</u>");
    s = s.replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      (_, label, href) =>
        stash(
          '<a class="pn-link" href="' +
            href +
            '" target="_blank" rel="noopener">' +
            label +
            "</a>"
        )
    );
    // @mentions: protect existing HTML tags so we don't match inside attrs
    const tagSlots = [];
    s = s.replace(/<[^>]+>/g, (m) => {
      tagSlots.push(m);
      return "\u0000T" + (tagSlots.length - 1) + "\u0000";
    });
    s = s.replace(
      /(^|[\s([{])@([A-Za-z][A-Za-z0-9._-]{0,40})/g,
      '$1<span class="pn-at">@$2</span>'
    );
    s = s.replace(/\u0000T(\d+)\u0000/g, (_, i) => tagSlots[Number(i)]);
    // italics without lookbehind (WebView-safe) — only outside stashed code
    s = s.replace(
      /(^|[^*])\*([^*\n]+)\*(?!\*)/g,
      "$1<em>$2</em>"
    );
    s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    s = s.replace(/\u0000S(\d+)\u0000/g, (_, i) => slots[Number(i)]);
    return s;
  }

  function renderMarkdown(src) {
    const text = String(src ?? "");
    if (!text.trim()) {
      return '<span class="pn-blank">blank · edit ▌ or Ctrl+E</span>';
    }
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;
    let inCode = false;
    let codeBuf = [];
    let codeStart = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (line.trim().startsWith("```")) {
        if (inCode) {
          out.push(
            '<pre class="pn-codeblock" data-line="' +
              codeStart +
              '"><code>' +
              esc(codeBuf.join("\n")) +
              "</code></pre>"
          );
          codeBuf = [];
          inCode = false;
        } else {
          inCode = true;
          codeStart = i;
        }
        i++;
        continue;
      }
      if (inCode) {
        codeBuf.push(line);
        i++;
        continue;
      }

      const cb = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
      if (cb) {
        const checked = cb[1].toLowerCase() === "x";
        out.push(
          '<div class="pn-check' +
            (checked ? " is-done" : "") +
            '" data-line="' +
            i +
            '"><span class="pn-check-box">' +
            (checked ? "☑" : "☐") +
            '</span><span class="pn-check-label">' +
            renderMdInline(cb[2]) +
            "</span></div>"
        );
        i++;
        continue;
      }

      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        const lvl = h[1].length;
        const tag = "h" + (lvl + 1);
        out.push(
          "<" +
            tag +
            ' class="pn-md-h pn-md-h' +
            lvl +
            '" data-line="' +
            i +
            '">' +
            renderMdInline(h[2] || "") +
            "</" +
            tag +
            ">"
        );
        i++;
        continue;
      }

      const li = line.match(/^\s*[-*]\s+(.*)$/);
      if (li) {
        out.push(
          '<div class="pn-md-line pn-md-li" data-line="' +
            i +
            '"><span class="pn-md-bullet">•</span> ' +
            renderMdInline(li[1]) +
            "</div>"
        );
        i++;
        continue;
      }

      const body = line.trimEnd();
      if (body === "") {
        out.push(
          '<div class="pn-md-blank" data-line="' + i + '" aria-hidden="true"></div>'
        );
      } else if (body === "---" || body === "***") {
        out.push('<hr class="pn-md-hr" data-line="' + i + '" />');
      } else if (body.startsWith("> ")) {
        out.push(
          '<div class="pn-md-line pn-md-quote" data-line="' +
            i +
            '">' +
            renderMdInline(body.slice(2)) +
            "</div>"
        );
      } else {
        out.push(
          '<div class="pn-md-line" data-line="' +
            i +
            '">' +
            renderMdInline(body) +
            "</div>"
        );
      }
      i++;
    }
    if (inCode) {
      out.push(
        '<pre class="pn-codeblock" data-line="' +
          codeStart +
          '"><code>' +
          esc(codeBuf.join("\n")) +
          "</code></pre>"
      );
    }
    return out.join("");
  }

  /** Caret line index in a textarea (0-based). */
  function caretLine(ta) {
    const pos = ta.selectionStart || 0;
    const upto = ta.value.slice(0, pos);
    return upto.split("\n").length - 1;
  }

  /**
   * Scroll paper preview so source line is visible / near top-third.
   */
  function scrollPreviewToLine(previewEl, lineIdx) {
    if (!previewEl) return;
    const target =
      previewEl.querySelector('[data-line="' + lineIdx + '"]') ||
      previewEl.querySelector("[data-line]");
    if (!target) return;
    const pref = previewEl.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const relTop = t.top - pref.top + previewEl.scrollTop;
    const want = relTop - pref.height * 0.28;
    previewEl.scrollTop = Math.max(0, want);
    previewEl.querySelectorAll(".is-src-line").forEach((n) => {
      n.classList.remove("is-src-line");
    });
    target.classList.add("is-src-line");
  }

  window.ReceiverLiveMd = {
    renderMarkdown,
    caretLine,
    scrollPreviewToLine,
    PAPERS: ["plain", "lined", "dotted", "letter"],
  };
})();
