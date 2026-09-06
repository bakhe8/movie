# POSTERS-MULTI P5 — اتجاهات عرض مجموعة البوسترات (2026-09-06)

مصدر لوحة Claude Design «مجموعة بوسترات الفيلم». الرأس والبطاقات منقولة من `WorkScreen.module.css` و`DiscoverScreen.module.css` بقيمها الفعلية (مظهر cinema، الثيم الداكن).

- **الصفحة الأولى — الاتجاه د (توجيه المالك)**: `Main` الاكتشاف على الهاتف يدور تلقائيًا (تفاعلي، بمقابض المدة/الاستمرار/محاكاة التمرير/Reduced Motion) · `DirectionDWork` صفحة الفيلم على الهاتف (تفاعلي) · `DirectionDDesktop` سطح المكتب بالتحويم (تفاعلي) · `StoryD` · `RulesD` المعلمات والأسطح والقرارات.
- **الصفحة الثانية — أرشيف**: أ (`DirectionA`، `DirectionAWork`، `DirectionADesktop`، `StoryA`) و ب (`DirectionB`، `DirectionBDesktop`، `StoryB`، `Cards`) و`Rules` عقدهما.
- الصور غير مُلتزمة (بوسترات TMDB تُعرض بالرابط ولا تُخزَّن محليًا): تُجلب عند إعادة البناء إلى مجلد مؤقت بمسارات `title_posters` لـ`DEMO0137` (`inter-1..4`)، `DEMO0152` (`oppen-1..4`)، `DEMO0149` (`dune-1..4`)، `DEMO0043` (`cap-1..4`)، و`DEMO0064` (`one-1`)، مقاس w342 ثم ضغط إلى ≤68KB.
- إعادة البناء: مولّدا `gen-posters-canvas-v2.py` + `gen-posters-canvas-v3.py` (خارج المستودع) ثم أداة seed الخاصة بمهارة design مع `--image` لكل صورة.
