'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Title, type Triad } from '../lib/api';
import { TRIAD_INSTRUCTION } from '../lib/copy';

const labels = {
  ar: {
    eyebrow: 'ثلاثية',
    title: TRIAD_INSTRUCTION.ar,
    hint: 'اسحب البطاقات أو استخدم الأسهم. البطاقة الأولى هي الأكثر إعجابًا.',
    save: 'حفظ الترتيب',
    saving: 'جارٍ الحفظ…',
    loading: 'جارٍ التحضير…',
    needMore: 'أكمل تسجيل ثلاثة أفلام على الأقل كمُشاهَدة في تبويب اكتشف لتبدأ الترتيب.',
    nextRound: 'جولة جديدة جاهزة!',
  },
  en: {
    eyebrow: 'Triad',
    title: TRIAD_INSTRUCTION.en,
    hint: 'Drag the cards or use the arrows. The first card is the one you liked most.',
    save: 'Save ranking',
    saving: 'Saving…',
    loading: 'Preparing…',
    needMore: 'Mark at least three films as watched in Discover before you can start ranking.',
    nextRound: 'New round ready!',
  },
};

export function RankScreen({ lang, profileId }: { lang: 'ar' | 'en'; profileId: string }) {
  const [triad, setTriad] = useState<Triad | null>(null);
  const [order, setOrder] = useState<Title[]>([]);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const t = labels[lang];

  const loadTriad = useCallback(async () => {
    setLoading(true);
    setBlockedMessage(null);
    try {
      const current = await api.getCurrentTriad(profileId);
      setTriad(current);
      const displayIds = current.displayOrder ?? current.titleIds;
      const titles = await Promise.all(displayIds.map((id) => api.getTitle(id)));
      setOrder(titles);
    } catch (err) {
      if (err instanceof ApiError) {
        setBlockedMessage(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    // loadTriad's own setState calls all happen after an `await`, inside
    // its async body, not synchronously in this effect -- this is the
    // standard "fetch on mount / on dependency change" pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTriad();
  }, [loadTriad]);

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length) return;
    setOrder((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function submitRanking() {
    if (!triad) return;
    setSaving(true);
    try {
      // `order` is the user's preferred sequence (best first); `ranking`
      // must be indices into triad.titleIds, per RankTriadDto.
      const ranking = order.map((title) => triad.titleIds.indexOf(title.id));
      await api.rankTriad(triad.id, ranking);
      await loadTriad();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="muted">{t.loading}</p>;
  }

  if (blockedMessage) {
    return <p className="notice">{t.needMore}</p>;
  }

  return (
    <>
      <p className="eyebrow">{t.eyebrow}</p>
      <h2>{t.title}</h2>
      <p className="muted">{t.hint}</p>
      <div className="rank-list">
        {order.map((title, index) => (
          <article
            className="rank-card"
            draggable
            key={title.id}
            onDragStart={(event) => event.dataTransfer.setData('index', String(index))}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => move(Number(event.dataTransfer.getData('index')), index)}
          >
            <span className="position">{index + 1}</span>
            <div>
              <small>{title.releaseYear}</small>
              <h3>{lang === 'ar' ? title.titleAr : title.titleEn}</h3>
              <p className="genres">{title.genres?.join(' · ')}</p>
              <p>{title.description}</p>
            </div>
            <div className="move">
              <button type="button" onClick={() => move(index, index - 1)} disabled={index === 0}>
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, index + 1)}
                disabled={index === order.length - 1}
              >
                ↓
              </button>
            </div>
          </article>
        ))}
      </div>
      <button className="cta full" onClick={submitRanking} disabled={saving}>
        {saving ? t.saving : t.save}
      </button>
    </>
  );
}
