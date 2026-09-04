'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { api, type ReplacementReason, type Title, type Triad } from '../lib/api';
import { TRIAD_INSTRUCTION } from '../lib/copy';
import { formatNumber } from '../lib/format';
import { Poster } from './Poster';
import styles from './RankScreen.module.css';

type Lang = 'ar' | 'en';

// Every string on this screen. The instruction itself is fixed product copy
// (lib/copy.ts, blueprint §4.3) and must not be paraphrased here.
const labels = {
  ar: {
    eyebrow: 'ثلاثية',
    title: TRIAD_INSTRUCTION.ar,
    // Blocked: there are no films to rank yet, so the instruction would lie.
    blockedTitle: 'قبل أول ثلاثية',
    hint: 'اسحب من المقبض أو استخدم الأسهم. البطاقة الأولى هي الأكثر إعجابًا.',
    save: 'حفظ الترتيب',
    saving: 'جارٍ الحفظ…',
    saved: 'تم الحفظ. هذه جولة جديدة.',
    rounds: (n: string) => `جولاتك المكتملة: ${n}`,
    // SPECIFICATION §5.1 step 4: 3–5 seed rounds; the exact count is an open
    // App. C experiment, so this is a range, not a target.
    roundsHint: 'ثلاث إلى خمس جولات تكفي لأول نتيجة، وكل جولة بعدها تحسّنها.',
    firstResult: 'اكتملت ثلاث جولات. توصياتك الأولى وترتيب مكتبتك يظهران بعد تدريب نموذجك.',
    dragHandle: 'اسحب لتغيير الترتيب',
    moveUp: 'ارفع درجة',
    moveDown: 'أنزل درجة',
    position: (n: number) => `الترتيب ${n}`,
    notWatched: 'لم أشاهده',
    notRemembered: 'لا أتذكره',
    confirmNotWatched: (title: string) => `سنستبدل «${title}» بفيلم آخر شاهدته. لا يُحتسب هذا رأيًا في الفيلم.`,
    confirmNotRemembered: (title: string) => `سنستبدل «${title}» ولن نسألك عنه مجددًا. لا يُحتسب هذا رأيًا في الفيلم.`,
    confirm: 'تأكيد الاستبدال',
    cancel: 'إلغاء',
    replacing: 'جارٍ الاستبدال…',
    replaced: 'تم الاستبدال.',
    exhausted: 'لم يبقَ فيلم بديل، لذا بدأنا جولة جديدة.',
    replaceFailed: 'تعذّر الاستبدال. حاول مجددًا.',
    needMore: (needed: number) =>
      needed === 1
        ? 'سجّل فيلمًا واحدًا آخر كمُشاهَد في «اكتشف» لبدء جولة جديدة.'
        : needed === 2
          ? 'سجّل فيلمين آخرين كمُشاهَدين في «اكتشف» لتبدأ الترتيب.'
          : 'سجّل ثلاثة أفلام على الأقل كمُشاهَدة في «اكتشف» لتبدأ الترتيب.',
    loadFailed: 'تعذّر تحميل الثلاثية.',
    retry: 'إعادة المحاولة',
    // The one action on the blocked state (decision Q18: the triad is the
    // first screen; when it cannot be drawn yet, the way forward is one tap).
    goDiscover: 'اختر أفلامًا شاهدتها',
  },
  en: {
    eyebrow: 'Triad',
    title: TRIAD_INSTRUCTION.en,
    blockedTitle: 'Before your first triad',
    hint: 'Drag by the handle or use the arrows. The first card is the one you liked most.',
    save: 'Save ranking',
    saving: 'Saving…',
    saved: 'Saved. Here is a new round.',
    rounds: (n: string) => `Completed rounds: ${n}`,
    roundsHint: 'Three to five rounds are enough for a first result; every round after that improves it.',
    firstResult: 'Three rounds done. Your first recommendations and library ranking appear once your model is trained.',
    dragHandle: 'Drag to reorder',
    moveUp: 'Move up',
    moveDown: 'Move down',
    position: (n: number) => `Position ${n}`,
    notWatched: "Haven't watched",
    notRemembered: "Don't remember",
    confirmNotWatched: (title: string) =>
      `We'll swap “${title}” for another film you have watched. This is not counted as an opinion about it.`,
    confirmNotRemembered: (title: string) =>
      `We'll swap “${title}” and never ask about it again. This is not counted as an opinion about it.`,
    confirm: 'Confirm swap',
    cancel: 'Cancel',
    replacing: 'Swapping…',
    replaced: 'Swapped.',
    exhausted: 'No replacement was left, so a new round has started.',
    replaceFailed: 'The swap failed. Please try again.',
    needMore: (needed: number) =>
      needed === 1
        ? 'Mark one more film as watched in Discover to start a new round.'
        : needed === 2
          ? 'Mark two more films as watched in Discover before you can rank.'
          : 'Mark at least three films as watched in Discover before you can rank.',
    loadFailed: 'The triad could not be loaded.',
    retry: 'Try again',
    goDiscover: 'Pick films you have watched',
  },
};

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'blocked'; needed: number } | { kind: 'failed' };

// Posters are shown only once a title carries a licensed image
// (docs/DATA_LICENSING.md rule 5). The API has no such field yet; this local
// extension lets the card render one the day it appears without touching
// lib/api.ts. Until then every triad card is a text card.

interface DragState {
  from: number;
  // Slot the lifted card lands in on release.
  to: number;
  // Pointer travel since pointerdown, in px; the lifted card follows it.
  dy: number;
}

interface PendingReplacement {
  titleId: string;
  reason: ReplacementReason;
}

function GripIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="5" r="1.8" />
      <circle cx="9" cy="12" r="1.8" />
      <circle cx="9" cy="19" r="1.8" />
      <circle cx="15" cy="5" r="1.8" />
      <circle cx="15" cy="12" r="1.8" />
      <circle cx="15" cy="19" r="1.8" />
    </svg>
  );
}

export function RankScreen({
  lang,
  profileId,
  onGoToDiscover,
}: {
  lang: Lang;
  profileId: string;
  // Where "pick films you have watched" leads when the triad is blocked.
  onGoToDiscover?: () => void;
}) {
  const t = labels[lang];
  const [triad, setTriad] = useState<Triad | null>(null);
  const [order, setOrder] = useState<Title[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<PendingReplacement | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [completedRounds, setCompletedRounds] = useState<number | null>(null);
  // Pointer handlers read the live drag state through this ref so they never
  // see a stale closure mid-gesture; `drag` (state) only drives rendering.
  const dragRef = useRef<DragState | null>(null);
  const startYRef = useRef(0);
  const cardRefs = useRef<(HTMLLIElement | null)[]>([]);

  const hydrate = useCallback(async (current: Triad) => {
    // Cards are shown in the server's displayOrder (randomised independently
    // of titleIds so position bias can be measured, blueprint §4.3). The
    // triad carries its three titles inline in that order; the per-title
    // fallback only covers a response from an older backend.
    const titles = current.items?.length
      ? current.items
      : await Promise.all((current.displayOrder ?? current.titleIds).map((id) => api.getTitle(id)));
    setTriad(current);
    setOrder(titles);
    setPending(null);
  }, []);

  const loadTriad = useCallback(async () => {
    setPhase({ kind: 'loading' });
    // Rounds so far, shown next to the instruction; independent of whether a
    // new triad can be drawn right now.
    api
      .getCompletedTriads(profileId)
      .then((completed) => setCompletedRounds(completed.length))
      .catch(() => setCompletedRounds(null));
    try {
      // ADR-80: 200 with a state discriminator instead of 400.
      const result = await api.getCurrentTriad(profileId);
      if (result.state === 'need_more_watched') {
        setPhase({ kind: 'blocked', needed: result.needed });
      } else {
        await hydrate(result);
        setPhase({ kind: 'ready' });
      }
    } catch {
      setPhase({ kind: 'failed' });
    }
  }, [profileId, hydrate]);

  useEffect(() => {
    // loadTriad's own setState calls all happen after an `await`, inside
    // its async body, not synchronously in this effect -- this is the
    // standard "fetch on mount / on dependency change" pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTriad();
  }, [loadTriad]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const busy = saving || replacing || phase.kind !== 'ready';

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= order.length) return;
    setOrder((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  // --- Pointer-driven reorder ---------------------------------------------
  // Works the same for touch, pen and mouse (HTML5 drag-and-drop does not
  // fire on touch at all). The handle has `touch-action: none`, so the
  // browser hands the gesture to us instead of scrolling the page.

  function updateDrag(next: DragState | null) {
    dragRef.current = next;
    setDrag(next);
  }

  // The slot the lifted card lands in: how many *other* cards' midpoints the
  // pointer has passed.
  function dropIndexFor(clientY: number, from: number): number {
    let index = 0;
    cardRefs.current.forEach((card, i) => {
      if (!card || i === from) return;
      const rect = card.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) index += 1;
    });
    return index;
  }

  function onHandlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    if (busy) return;
    try {
      // Keeps pointermove/up coming to the handle even when the finger
      // leaves it. Can throw when the pointer is already gone (a very short
      // tap) -- the gesture still works without capture, so never fatal.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // no capture available for this pointer
    }
    startYRef.current = event.clientY;
    updateDrag({ from: index, to: index, dy: 0 });
  }

  function onHandlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current) return;
    event.preventDefault();
    updateDrag({
      from: current.from,
      to: dropIndexFor(event.clientY, current.from),
      dy: event.clientY - startYRef.current,
    });
  }

  function onHandlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    updateDrag(null);
    move(current.from, current.to);
  }

  function onHandlePointerCancel() {
    updateDrag(null);
  }

  // --- Actions -------------------------------------------------------------

  async function submitRanking() {
    if (!triad) return;
    setSaving(true);
    try {
      // `order` is the user's preferred sequence (best first); `ranking` is
      // the title ids themselves, not indices into triad.titleIds (ADR-15).
      // A fresh key per attempt (not per retry) makes a network retry or
      // double-click safe -- the backend returns the same result instead of
      // an "already submitted" error.
      const ranking = order.map((title) => title.id);
      await api.rankTriad(triad.id, ranking, crypto.randomUUID());
      const reached = (completedRounds ?? 0) + 1;
      setCompletedRounds(reached);
      // The third round is where a first result becomes possible (§5.1 step
      // 5); training is still a manual step, hence "once your model is trained".
      setNotice(reached === 3 ? t.firstResult : t.saved);
      await loadTriad();
    } catch {
      setNotice(t.loadFailed);
    } finally {
      setSaving(false);
    }
  }

  async function confirmReplacement() {
    if (!triad || !pending) return;
    setReplacing(true);
    try {
      const result = await api.replaceTriadItem(triad.id, pending.titleId, pending.reason);
      if (result.status === 'skipped') {
        // Nothing eligible was left to swap in: the backend abandoned this
        // round, so ask for the current one (a fresh draw, or "mark N more").
        setNotice(t.exhausted);
        await loadTriad();
      } else {
        await hydrate(result);
        setNotice(t.replaced);
      }
    } catch {
      setNotice(t.replaceFailed);
    } finally {
      setReplacing(false);
    }
  }

  // --- Render ----------------------------------------------------------------

  // A <div>, not <header>: globals.css styles the bare `header` element as
  // the app's 72px top bar, which would squash this block into a flex row.
  const header = (
    <div className={styles.header}>
      <p className={styles.eyebrow}>{t.eyebrow}</p>
      <h2>{phase.kind === 'blocked' ? t.blockedTitle : t.title}</h2>
      {phase.kind === 'ready' && <p className={styles.hint}>{t.hint}</p>}
      {completedRounds !== null && (
        <p className={styles.rounds}>
          <span className={styles.roundsCount}>{t.rounds(formatNumber(completedRounds, lang))}</span>
          {' · '}
          {t.roundsHint}
        </p>
      )}
    </div>
  );

  if (phase.kind === 'loading') {
    return (
      <div className={styles.screen} aria-busy="true">
        {header}
        <div className={styles.list}>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      </div>
    );
  }

  if (phase.kind === 'blocked') {
    return (
      <div className={styles.screen}>
        {header}
        {/* e.g. "no replacement was left, so a new round has started" -- the
            reason the user is now looking at this message. */}
        {notice && (
          <p className={styles.status} role="status">
            {notice}
          </p>
        )}
        <p className={`${styles.status} ${styles.error}`} role="alert">
          {t.needMore(phase.needed)}
        </p>
        {/* The screen's single filled action (Q6, Q18): the watched set is the
            only thing that unblocks a triad (blueprint §4.1, SPEC §5.1 step 3). */}
        {onGoToDiscover && (
          <button type="button" className={styles.cta} onClick={onGoToDiscover}>
            {t.goDiscover}
          </button>
        )}
      </div>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <div className={styles.screen}>
        {header}
        <p className={`${styles.status} ${styles.error}`} role="alert">
          {t.loadFailed}
        </p>
        <button type="button" className={styles.retry} onClick={loadTriad}>
          {t.retry}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      {header}
      {notice && (
        <p className={styles.status} role="status">
          {notice}
        </p>
      )}
      <ol className={drag ? `${styles.list} ${styles.dragging}` : styles.list}>
        {order.map((title, index) => {
          const name = lang === 'ar' ? title.titleAr : title.titleEn;
          // The other language's title helps recognise a film known under a
          // different name (same as Discover and the library).
          const alt = lang === 'ar' ? title.titleEn : title.titleAr;
          const lifted = drag?.from === index;
          const isTarget = drag !== null && drag.to !== drag.from && drag.to === index;
          const isPending = pending?.titleId === title.id;
          // Card content is poster (when licensed), title and year only --
          // no critic scores, no genres, no synopsis (blueprint §4.3; decisions
          // Q17). The other-language title shares the year's muted line (Q13).
          const showAlt = Boolean(alt && alt !== name);
          const className = [styles.card, styles.withPoster, lifted && styles.lifted, isTarget && styles.target]
            .filter(Boolean)
            .join(' ');

          return (
            <li
              key={title.id}
              ref={(element) => {
                cardRefs.current[index] = element;
              }}
              className={className}
              style={lifted && drag ? { transform: `translateY(${drag.dy}px)` } : undefined}
              aria-label={t.position(index + 1)}
            >
              <span className={styles.badge} aria-hidden="true">
                {formatNumber(index + 1, lang)}
              </span>
              {/* The poster slot is always present (owner decision 2026-09-04); hollow until licensed. */}
              <Poster title={title} size="sm" className={styles.poster} />
              <div className={styles.body}>
                <h3 className={styles.title}>{name}</h3>
                {(showAlt || title.releaseYear) && (
                  <p className={styles.alt}>
                    {showAlt && <bdi>{alt}</bdi>}
                    {/* A year is an identifier, not a quantity: no grouping separator.
                        The separator and the year wrap as one unit (audit 2026-09-04). */}
                    {title.releaseYear && (
                      <span className={styles.yearTail}>
                        {showAlt ? ' · ' : ''}
                        {String(title.releaseYear)}
                      </span>
                    )}
                  </p>
                )}
              </div>
              <div className={styles.controls}>
                {/* Not focusable on purpose: the arrows are the keyboard path. */}
                <button
                  type="button"
                  className={styles.handle}
                  tabIndex={-1}
                  aria-label={t.dragHandle}
                  onPointerDown={(event) => onHandlePointerDown(event, index)}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={onHandlePointerUp}
                  onPointerCancel={onHandlePointerCancel}
                >
                  <GripIcon />
                </button>
                <button
                  type="button"
                  className={styles.arrow}
                  aria-label={t.moveUp}
                  onClick={() => move(index, index - 1)}
                  disabled={busy || index === 0}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={styles.arrow}
                  aria-label={t.moveDown}
                  onClick={() => move(index, index + 1)}
                  disabled={busy || index === order.length - 1}
                >
                  ↓
                </button>
              </div>

              {/* Two separate, neutral controls (blueprint §4.3, ADR-17). A
                  one-step confirmation replaces a modal: it says what will
                  happen and that it is not an opinion about the film. */}
              {isPending && pending ? (
                <div className={styles.confirm} role="group">
                  <p>{pending.reason === 'not_watched' ? t.confirmNotWatched(name) : t.confirmNotRemembered(name)}</p>
                  <div className={styles.confirmActions}>
                    <button type="button" className={styles.primarySmall} onClick={confirmReplacement} disabled={replacing}>
                      {replacing ? t.replacing : t.confirm}
                    </button>
                    <button type="button" className={styles.ghost} onClick={() => setPending(null)} disabled={replacing}>
                      {t.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.replaceRow}>
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => setPending({ titleId: title.id, reason: 'not_watched' })}
                    disabled={busy}
                  >
                    {t.notWatched}
                  </button>
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => setPending({ titleId: title.id, reason: 'not_remembered' })}
                    disabled={busy}
                  >
                    {t.notRemembered}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <button type="button" className={styles.cta} onClick={submitRanking} disabled={busy}>
        {saving ? t.saving : t.save}
      </button>
    </div>
  );
}
