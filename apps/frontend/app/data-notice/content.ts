// Development notice and third-party data statement (owner decision
// 2026-09-04, docs/DATA_NOTICE_COPY_2026-09-04.md, DATA_LICENSING.md §0).
// The page says three things and nothing more: the service is under
// development and free; external data on it is used for development only,
// with its source and attribution kept, and is not traded or monetised;
// and no revenue model is adopted before the required permissions exist.
// Every sentence states what the product actually does today.

import type { Lang } from '../legal/content';

export interface NoticeSection {
  head: string;
  paragraphs?: string[];
  items?: string[];
}

export interface NoticeSource {
  name: string;
  what: string;
  terms: string;
  attribution: string;
}

export interface NoticeDocument {
  title: string;
  updated: string;
  draftNotice: string;
  intro: string;
  sections: NoticeSection[];
  sourcesHead: string;
  sourcesIntro: string;
  sources: NoticeSource[];
  sourcesColumns: { name: string; what: string; terms: string; attribution: string };
  contactHead: string;
  contactParagraphs: string[];
}

export const NOTICE_UPDATED = '2026-09-04';

// Placeholders until a domain and mailbox exist (PRIVACY.md §14 uses the same form).
const RIGHTS_CONTACT = 'rights@<domain>';

const SOURCES: Record<Lang, NoticeSource[]> = {
  ar: [
    {
      name: 'Wikidata',
      what: 'المعرّفات والعناوين بعدة لغات وسنوات الإنتاج وطواقم العمل والبلدان',
      terms: 'CC0 (ملك عام)',
      attribution: 'البيانات من Wikidata',
    },
    {
      name: 'ويكيبيديا',
      what: 'المقدمات وملخصات الحبكة كمدخل لاستخراج السمات وكنص وصفي',
      terms: 'CC BY-SA 4.0',
      attribution: 'النص من ويكيبيديا، رخصة CC BY-SA 4.0',
    },
    {
      name: 'TMDB',
      what: 'الملصقات والصور وبيانات وصفية تكميلية',
      terms: 'مفتاح المطوّر غير التجاري، مع الإسناد',
      attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    },
    {
      name: 'IMDb',
      what: 'التقييمات وعدد الأصوات ومطابقة العناوين وطواقم العمل من الملفات الرسمية غير التجارية',
      terms: 'الاستخدام الشخصي وغير التجاري، مع الإسناد، دون إعادة توزيع',
      attribution: 'Information courtesy of IMDb (https://www.imdb.com). Used with permission.',
    },
    {
      name: 'GroupLens (MovieLens)',
      what: 'بيانات بحثية للمقارنة والقياس خارج الخدمة، وقد تُستخدم لبذر نموذج جماعي في الفترة المجانية',
      terms: 'شروط الاستخدام البحثي؛ الاستخدام المُدرّ للإيراد يحتاج إذناً مسبقاً',
      attribution: 'F. Maxwell Harper and Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context. ACM TiiS 5, 4.',
    },
  ],
  en: [
    {
      name: 'Wikidata',
      what: 'identifiers, titles in many languages, years, credits, countries',
      terms: 'CC0 (public domain)',
      attribution: 'Data from Wikidata',
    },
    {
      name: 'Wikipedia',
      what: 'leads and plot summaries, as input for feature extraction and as descriptive text',
      terms: 'CC BY-SA 4.0',
      attribution: 'Text from Wikipedia, licensed CC BY-SA 4.0',
    },
    {
      name: 'TMDB',
      what: 'posters, images and supplementary metadata',
      terms: 'non-commercial developer key, with attribution',
      attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    },
    {
      name: 'IMDb',
      what: 'ratings, vote counts, title and credit matching from the official non-commercial datasets',
      terms: 'personal and non-commercial use, with attribution, no redistribution',
      attribution: 'Information courtesy of IMDb (https://www.imdb.com). Used with permission.',
    },
    {
      name: 'GroupLens (MovieLens)',
      what: 'research data for offline baselines and measurement; may seed a population model during the free period',
      terms: 'research-use terms; revenue-bearing use needs prior permission',
      attribution: 'F. Maxwell Harper and Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context. ACM TiiS 5, 4.',
    },
  ],
};

export const NOTICE: Record<Lang, NoticeDocument> = {
  ar: {
    title: 'إشعار مرحلة التطوير واستخدام البيانات الخارجية',
    updated: NOTICE_UPDATED,
    draftNotice: 'نسخة أولية بمراجعة فريق العمل. تُعرض منذ الآن حتى يعرف كل زائر، ومنهم أصحاب الحقوق، على أي أساس تظهر البيانات الخارجية في الخدمة.',
    intro:
      'هذا البرنامج وهذا الموقع كاملان قيد التطوير. كل ما يظهر فيهما من معلومات أفلام وصور وملصقات ووسائط ونصوص وصفية ودرجات وتقييمات وبيانات توفر يأتي من مصادر خارجية، ويُستخدم لغرض تطوير الخدمة واختبارها وتقييمها فقط. لا يُتاجَر بشيء منه ولا يُربَح منه، ولن يكون ذلك إلا بعد الحصول على التصاريح والتراخيص اللازمة من أصحابه.',
    sections: [
      {
        head: 'حالة الخدمة',
        items: [
          'الخدمة مجانية بالكامل ولا تحقق إيراداً من أي نوع: لا اشتراك، ولا إعلانات، ولا عمولة على أي رابط مشاهدة.',
          'لم يُعتمَد أي نموذج ربحي. يُدرَس ذلك بعد فترة عمل فعلي، وتُحسب فيه تكلفة كل ترخيص مطلوب قبل أي قرار.',
          'ما يُبنى الآن يُبنى بجودة الإنتاج، وتُعرض هذه الصفحة طوال فترة التطوير والفترة المجانية التي تليها حتى يُعتمَد نموذج ربحي ويُعمل به.',
        ],
      },
      {
        head: 'كيف نستخدم البيانات الخارجية',
        items: [
          'كل قيمة خارجية تحتفظ باسم مصدرها والإسناد الذي يشترطه، ويُعرض الإسناد حيث تظهر القيمة.',
          'الاستخدام مقصور على تطوير الخدمة وتشغيلها المجاني: عرض المعلومة للمستخدم مع إسنادها، ومطابقة العناوين، واستخراج سمات وصفية مجرّدة عن الأعمال.',
          'لا نبيع بيانات خارجية، ولا نعيد توزيعها بالجملة، ولا نصدّرها لأحد. تصدير بيانات المستخدم يحوي بياناته هو وحده.',
          'لا نجمع بيانات بكشط صفحات أي موقع؛ نأخذها من الواجهات والملفات التي يتيحها المصدر بشروطه المنشورة.',
          'حين نعرض درجة أو تقييماً نذكر مصدره وتاريخه ولا ندمجه مع مصدر آخر في رقم واحد.',
        ],
      },
      {
        head: 'تعهدنا',
        paragraphs: [
          'نتعهد بألا نتاجر بأي بيانات أو صور أو وسائط أو درجات خارجية ولا نربح منها، بشكل مباشر أو غير مباشر، قبل الحصول على التصاريح والتراخيص اللازمة من أصحاب حقوقها، وذلك التزاماً بالأنظمة الرسمية المعمول بها في شأن حقوق المؤلف والملكية الفكرية وبشروط كل مصدر المنشورة.',
          'عند اعتماد نموذج ربحي، تُستكمل التراخيص المطلوبة لكل مصدر قبل بدء أي إيراد، أو يُزال ما لا يُرخَّص من الخدمة. لا يبدأ إيراد على بيانات لم يُرخَّص استخدامها التجاري.',
          'هذه الصفحة إفصاح عن حسن نيتنا وحدود استخدامنا، وتُطبَّق مع شروط كل مصدر لا بديلاً عنها.',
        ],
      },
      {
        head: 'ما لا تغطيه هذه الصفحة',
        paragraphs: [
          'بياناتك الشخصية وموافقاتك وحقوقك عليها يحكمها إشعار الخصوصية وشروط الاستخدام، لا هذه الصفحة.',
        ],
      },
    ],
    sourcesHead: 'المصادر والإسناد',
    sourcesIntro:
      'المصادر التي قد تظهر بياناتها في الخدمة الآن، وشروط كل منها كما نفهمها من نصوصها المنشورة، والإسناد الذي نعرضه. المرجع لكل قيمة بعينها هو سجل الحقوق الداخلي الذي يذكر مصدرها.',
    sources: SOURCES.ar,
    sourcesColumns: { name: 'المصدر', what: 'ما نأخذه منه', terms: 'شروطه', attribution: 'الإسناد المعروض' },
    contactHead: 'لأصحاب الحقوق',
    contactParagraphs: [
      `إن كنت تملك حقاً في معلومة أو صورة أو وسيط يظهر في الخدمة ولا ترغب في ظهوره، أو ترى أن إسناده ناقص، راسلنا على ${RIGHTS_CONTACT} مع رابط الصفحة التي يظهر فيها. نزيل المادة أو نصحح إسنادها خلال سبعة أيام عمل، ولا نعيد عرضها إلا بإذنك.`,
    ],
  },
  en: {
    title: 'Development Notice and Third-Party Data Statement',
    updated: NOTICE_UPDATED,
    draftNotice: 'First version, reviewed by the team. Shown from now on so that every visitor, rights holders included, knows on what basis external data appears in the service.',
    intro:
      'This application and this website are entirely under development. Every piece of film information, image, poster, media, descriptive text, score, rating and availability value shown here comes from external sources and is used only to develop, test and evaluate the service. None of it is traded or monetised, and none of it will be until the required permissions and licenses have been obtained from its owners.',
    sections: [
      {
        head: 'Status of the service',
        items: [
          'The service is entirely free and earns no revenue of any kind: no subscription, no advertising, no commission on any watch link.',
          'No revenue model has been adopted. That is studied after a period of real operation, and the cost of every required license is part of that study before any decision.',
          'What is being built is built to production standard, and this page stays up throughout development and the free period that follows, until a revenue model is adopted and put into effect.',
        ],
      },
      {
        head: 'How we use external data',
        items: [
          'Every external value keeps the name of its source and the attribution that source requires, and the attribution is shown where the value appears.',
          'Use is limited to developing and running the free service: showing the information to the user with its attribution, matching titles, and deriving abstract descriptive features about works.',
          'We do not sell external data, redistribute it in bulk, or export it to anyone. A user data export contains that user’s own data only.',
          'We do not collect data by scraping any website; we take it from the interfaces and files each source provides under its published terms.',
          'When we show a score or rating we name its source and date and never merge it with another source into a single number.',
        ],
      },
      {
        head: 'Our commitment',
        paragraphs: [
          'We undertake not to trade in, or profit from, any external data, image, media or score, directly or indirectly, before obtaining the required permissions and licenses from its rights holders, in compliance with the applicable copyright and intellectual-property laws and with each source’s published terms.',
          'When a revenue model is adopted, the required licenses for each source are completed before any revenue starts, or whatever cannot be licensed is removed from the service. No revenue starts on data whose commercial use has not been licensed.',
          'This page is a disclosure of our good faith and the limits of our use. It applies together with each source’s terms, not in their place.',
        ],
      },
      {
        head: 'What this page does not cover',
        paragraphs: [
          'Your personal data, your consents and your rights over them are governed by the Privacy Notice and the Terms of Use, not by this page.',
        ],
      },
    ],
    sourcesHead: 'Sources and attribution',
    sourcesIntro:
      'The sources whose data may appear in the service now, each source’s terms as we understand them from its published text, and the attribution we display. For any specific value, the internal rights registry naming its source is the authority.',
    sources: SOURCES.en,
    sourcesColumns: { name: 'Source', what: 'What we take', terms: 'Its terms', attribution: 'Attribution shown' },
    contactHead: 'For rights holders',
    contactParagraphs: [
      `If you hold rights in information, an image or media that appears in the service and do not want it shown, or you believe its attribution is incomplete, write to ${RIGHTS_CONTACT} with a link to the page where it appears. We remove the material or correct its attribution within seven business days, and do not show it again without your permission.`,
    ],
  },
};
