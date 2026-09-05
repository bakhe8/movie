// Terms and Privacy Notice: user-facing copy written from
// docs/PRIVACY.md (principles §1, inventory §2, consent §3, rights §5,
// processors §6, retention §9, transparency §12) and the blueprint's promises.
// Every sentence states what the product actually does today; nothing here
// promises more than the code delivers.
// Changing a purpose's text bumps CONSENT_VERSION and re-asks (PRIVACY.md §3).

export type Lang = 'ar' | 'en';
export type LegalKind = 'terms' | 'privacy';

export interface LegalSection {
  head: string;
  paragraphs?: string[];
  items?: string[];
}

export interface LegalDocument {
  title: string;
  updated: string;
  draftNotice: string;
  intro: string;
  sections: LegalSection[];
}

const UPDATED = '2026-09-05';

export const LEGAL: Record<LegalKind, Record<Lang, LegalDocument>> = {
  terms: {
    ar: {
      title: 'شروط الاستخدام',
      updated: UPDATED,
      draftNotice: 'تصف هذه الشروط الخدمة وحقوقك كما تعمل حاليًا. يظهر تاريخ آخر تحديث أعلى الصفحة.',
      intro: 'Kolme خدمة توصيات أفلام تتعلم ذوقك من ترتيبك لأفلام شاهدتها، ثلاثة في كل مرة. باستخدامك الخدمة توافق على ما يلي.',
      sections: [
        {
          head: 'ما الخدمة',
          paragraphs: [
            'تسجّل ما شاهدت، وترتّب ثلاثيات قصيرة حسب إعجابك الشخصي، فيُبنى نموذج عن ذوقك يُستخدم لملفك وحده. التوصيات اقتراحات؛ لا يُحجب عنك محتوى ولا ميزة بقرار آلي، ولك دائمًا تجاهل أي اقتراح.',
            'لا نجوم ولا إعجاب: السؤال الوحيد هو الترتيب. ما لم تشاهده لا يُحتسب ضدّه.',
          ],
        },
        {
          head: 'الحساب',
          items: [
            'الخدمة للبالغين في هذه المرحلة. حسابات الأطفال تحتاج تصميم موافقة وحماية منفصلًا لم يُبنَ بعد.',
            'أنت مسؤول عن سرية كلمة مرورك. كلمات المرور تُخزَّن مجزّأة ولا يمكننا قراءتها.',
            'حسابك منفصل عن ملف ذوقك: الملف يحمل معرّفًا مستعارًا، ولا تربطه جداول النموذج والأحداث بهويتك.',
          ],
        },
        {
          head: 'الموافقات',
          paragraphs: [
            'كل غرض لمعالجة بياناتك له موافقة مستقلة بنصها ونسختها، ولا يُدمج غرض في آخر. الشروط وإشعار الخصوصية، وتخزين ما شاهدت، ونموذج ذوقك الخاص مطلوبة لعمل الخدمة. المساهمة في النموذج الجماعي وتحليلات المنتج اختياريتان، وتغيّرهما في أي وقت من الملف الشخصي.',
            'إن تغيّر نص غرض ما، تُسأل عنه من جديد.',
          ],
        },
        {
          head: 'الاستخدام المقبول',
          items: [
            'لا تستخدم الخدمة لجمع بيانات مستخدمين آخرين، ولا لمحاولة كسر عزل الحسابات أو الملفات.',
            'لا تُدخل إلى الخدمة محتوى لا تملك حق إدخاله.',
            'قد نعلّق حسابًا يُسيء استخدام الخدمة أو يهدد أمن مستخدميها.',
          ],
        },
        {
          head: 'بيانات الأفلام',
          paragraphs: [
            'معلومات الأفلام وصورها ودرجاتها تأتي من مصادر خارجية بشروطها المنشورة وبإسنادها المذكور حيث تُعرض، وتفصيلها في إشعار مرحلة التطوير واستخدام البيانات. لا نعرض صورة إلا حين يسمح سجل الحقوق بذلك؛ وإلا تبقى الفتحة فارغة.',
          ],
        },
        {
          head: 'ما لا نعد به',
          paragraphs: [
            'التوصيات تقدير قابل للخطأ، وتظهر مع مستوى ثقة لفظي لا رقم. لا نضمن توفر أي فيلم على أي منصة؛ التوفر معلومة تُعرض منفصلة ولا يُرتَّب بها ذوقك.',
          ],
        },
        {
          head: 'إنهاء الحساب',
          paragraphs: [
            'يمكنك من الملف الشخصي تنزيل نسخة من بياناتك بصيغة JSON بعد تأكيد كلمة المرور، أو مسح ملف ذوقك مع بقاء حسابك. ويمكنك طلب حذف الحساب بعد تأكيد كلمة المرور؛ يوقف الطلب معالجة ملفاتك ويحدد موعد التنفيذ بعد مهلة أمان، ويمكن إلغاؤه حتى ذلك الموعد. بعد تنفيذ الحذف لا يمكن التراجع.',
          ],
        },
        {
          head: 'تغيير هذه الشروط',
          paragraphs: ['إن غيّرنا الشروط تغييرًا جوهريًا، نطلب موافقتك من جديد على النص الجديد قبل المتابعة، ويبقى تاريخ آخر تحديث ظاهرًا أعلى هذه الصفحة.'],
        },
      ],
    },
    en: {
      title: 'Terms of Use',
      updated: UPDATED,
      draftNotice: 'These terms describe the service and your rights as they work today. The last-updated date appears above.',
      intro: 'Kolme is a film recommendation service that learns your taste from how you rank films you have watched, three at a time. By using the service you agree to the following.',
      sections: [
        {
          head: 'What the service is',
          paragraphs: [
            'You log what you have watched and rank short triads by how much you personally liked each film; a model of your taste is built and used for your profile only. Recommendations are suggestions: no content or feature is withheld by an automated decision, and you can always dismiss a suggestion.',
            'No stars, no likes: ranking is the only question. What you have not watched never counts against a film.',
          ],
        },
        {
          head: 'Your account',
          items: [
            'The service is for adults at this stage. Children’s accounts need a separate consent and protection design that is not built yet.',
            'You are responsible for keeping your password private. Passwords are stored hashed; we cannot read them.',
            'Your account is separate from your taste profile: the profile carries a pseudonymous id, and the model and event tables never reference your identity.',
          ],
        },
        {
          head: 'Consents',
          paragraphs: [
            'Every purpose for processing your data has its own consent, with its own text and version; no purpose is bundled into another. The terms and privacy notice, storing what you watched, and your own taste model are required for the service to work. Contributing to the shared model and product analytics are optional and can be changed any time from your profile.',
            'If a purpose’s text changes, you are asked again.',
          ],
        },
        {
          head: 'Acceptable use',
          items: [
            'Do not use the service to collect other users’ data or to attempt to break the isolation between accounts or profiles.',
            'Do not put into the service content you have no right to.',
            'We may suspend an account that abuses the service or threatens its users’ security.',
          ],
        },
        {
          head: 'Film data',
          paragraphs: [
            'Film information, images and scores come from external sources under their published terms, with the attribution shown where they appear; the development notice and data statement gives the detail. An image is shown only when the rights registry allows it; otherwise the slot stays empty.',
          ],
        },
        {
          head: 'What we do not promise',
          paragraphs: [
            'Recommendations are fallible estimates, shown with a verbal confidence level rather than a number. We do not guarantee that any film is available on any platform; availability is shown separately and never ranks your taste.',
          ],
        },
        {
          head: 'Ending your account',
          paragraphs: [
            'From your profile, you can download a JSON copy of your data after confirming your password, or wipe your taste profile while keeping your account. You can also request account deletion after confirming your password; the request pauses processing for your profiles, sets an execution date after a safety period, and can be cancelled until that date. Deletion cannot be undone after it runs.',
          ],
        },
        {
          head: 'Changes to these terms',
          paragraphs: ['If we change the terms materially, we ask for your agreement to the new text before you continue, and the last-updated date stays visible at the top of this page.'],
        },
      ],
    },
  },
  privacy: {
    ar: {
      title: 'إشعار الخصوصية',
      updated: UPDATED,
      draftNotice: 'يصف هذا الإشعار البيانات التي تعالجها الخدمة وحقوقك المتاحة حاليًا. يظهر تاريخ آخر تحديث أعلى الصفحة.',
      intro: 'ملفك خاص افتراضيًا: لا صفحة عامة، ولا مشاركة إلا بقرارك، ولا يُباع ملف ذوقك، ولا نستنتج سمات حساسة من مشاهداتك.',
      sections: [
        {
          head: 'ما نجمعه ولماذا',
          items: [
            'البريد وكلمة المرور المجزّأة والاسم: للحساب والدخول والأمان.',
            'لغة الواجهة والسوق والمنصات: للعرض والتوفر فقط، لا للذوق.',
            'ما سجّلته كمُشاهَد أو لم تشاهده وقائمتك: لبناء الثلاثيات والتوصيات وقيمة التوفر.',
            'جولات الترتيب واستبدالاتها: لتدريب نموذج ذوقك الخاص.',
            'ما عُرض عليك من توصيات وما نتج عنها: لإغلاق الحلقة وتقييم الجودة، ثم تُجمَّع بعد 24 شهرًا.',
            'الموافقات وطلبات الخصوصية: سجل امتثال يبقى، ويتحول إلى أثر خالٍ من البيانات الشخصية بعد الحذف.',
            'سجل التدقيق وسجلات الخادم: للأمن ومنع الإساءة؛ سجلات الخادم تُحفظ 30 يومًا.',
          ],
        },
        {
          head: 'ما لا نجمعه ولا نستنتجه',
          paragraphs: [
            'لا موقعًا دقيقًا، ولا بصمات أجهزة أو ملفات تعقّب، ولا معرّفات إعلانية لطرف ثالث، ولا بيانات حيوية أو صحية. ولا نستنتج أبدًا الدين أو السياسة أو التوجه الجنسي أو الصحة من مشاهداتك أو ترتيباتك؛ هذا حظر صارم مطبق في قواعد التفسير ومفردات السمات والمراجعة.',
          ],
        },
        {
          head: 'الموافقات',
          items: [
            'الشروط وإشعار الخصوصية: عند التسجيل، مطلوبة لاستخدام الخدمة.',
            'تخزين ما شاهدت: عند التهيئة، مطلوبة لعمل الخدمة.',
            'نموذج ذوقك الخاص: عند التهيئة، مطلوبة لعمل الخدمة؛ يُستخدم لملفك وحده.',
            'المساهمة في النموذج الجماعي: اختيارية، افتراضها التشغيل بنص واضح؛ ترتيباتك المستعارة، دون أن تُنسب إليك، تساعد نموذجًا جماعيًا يحسّن الثلاثيات والترشيحات للجميع. إيقافها يستبعد ملفك من إعادة التدريب التالية ولا يمس نموذجك الشخصي.',
            'تحليلات المنتج: اختيارية؛ أحداث تشغيلية على أنظمتنا فقط، لا طرف ثالث ولا إعلانات.',
            'معالجة الاستيراد: تُطلب عند استيراد قائمة، والملف الخام يُحذف بعد قراءته.',
          ],
        },
        {
          head: 'حقوقك',
          items: [
            'مسح ملف الذوق: متاح الآن من الملف الشخصي؛ يحذف الجولات والعلامات والنموذج ويبقي الحساب.',
            'تغيير الموافقات الاختيارية: متاح الآن من الملف الشخصي.',
            'الوصول والتصدير: متاحان الآن من الملف الشخصي؛ بعد تأكيد كلمة المرور يمكنك تنزيل نسخة JSON قابلة للنقل من بيانات حسابك وملفاتك وطلبات الخصوصية.',
            'الحذف: متاح الآن من الملف الشخصي بعد تأكيد كلمة المرور. يوقف الطلب معالجة ملفاتك ويحدد موعد التنفيذ بعد مهلة أمان؛ يمكنك إلغاء الطلب حتى ذلك الموعد، وبعد التنفيذ لا يمكن التراجع.',
            'التصحيح: بيانات المصدر عبر الدعم؛ تصحيح الذوق بجولة ترتيب جديدة، فالأصل لا يُعدَّل في مكانه.',
            'الاعتراض على القرار الآلي: التوصيات اقتراحات، ولا يُحجب عنك شيء بقرار آلي.',
          ],
        },
        {
          head: 'من يعالج البيانات غيرنا',
          paragraphs: [
            'نستخدم مزوّد نماذج لغوية لوصف الأفلام وإعادة صياغة التفسيرات، ولا يُرسل إليه إلا أدلة عن الأفلام: لا معرّفات مستخدمين، ولا بريد، ولا ترتيبات، ولا تفضيلات، ولا سجل مشاهدة، ولا نص من ملفك.',
            'مزوّدو بيانات الأفلام والتوفر يستقبلون بيانات محتوى لا بيانات شخصية، باستثناء واحد نذكره صراحة: ملصقات الأفلام تُطلَب من خادم TMDB (image.tmdb.org) بمتصفّحك مباشرة ولا تمرّ بخوادمنا، فيرى TMDB عنوان IP الخاص بك ونوع متصفّحك كأي موقع تفتحه. لا نرسل إليه هويتك: الملصق لا يحمل معرّفك، ونطلب من المتصفّح ألا يمرّر عنوان الصفحة مع الصورة (no-referrer). في مواضع قليلة تُرسم فيها الصورة نفسها خلفيةً بـCSS يمرّر المتصفّح اسم نطاقنا وحده بحكم إعداده الافتراضي، لا مسار الصفحة.',
            'لم نضع وسيطاً للصور على نطاقنا لأنه يجعلنا ننقل صور TMDB بأنفسنا، وذلك قرار ترخيص لم يُحسم بعد. سنعيد النظر فيه عند حسمه.',
            'الاستضافة على Railway (الخوادم وقاعدة البيانات في أوروبا الغربية) خلف Cloudflare، والنسخ الاحتياطية مشفّرة في حاوية أوروبية خاصة.',
          ],
        },
        {
          head: 'الأمان',
          paragraphs: [
            'التشفير في النقل والتخزين، وتفويض على مستوى الكائن في كل مسار يخص ملفًا، وحدود معدل، وسجل تدقيق لكل فعل إداري، وعزل خدمة النموذج عن الهوية.',
          ],
        },
        {
          head: 'الاحتفاظ',
          paragraphs: [
            'بيانات الحساب والذوق تبقى حتى الحذف أو المسح. ما عُرض عليك ونتائجه 24 شهرًا ثم يُجمَّع. سجلات الخادم 30 يومًا. الموافقات وطلبات الخصوصية تبقى كسجل امتثال بلا بيانات شخصية بعد الحذف.',
          ],
        },
        {
          head: 'التواصل',
          paragraphs: ['قناة التواصل الخاصة بالخصوصية تُعلن في هذه الصفحة قبل الإطلاق.'],
        },
      ],
    },
    en: {
      title: 'Privacy Notice',
      updated: UPDATED,
      draftNotice: 'This notice describes the data the service processes and the rights available to you today. The last-updated date appears above.',
      intro: 'Your profile is private by default: no public page, no sharing unless you choose it, your taste profile is never sold, and no sensitive trait is ever inferred from what you watch.',
      sections: [
        {
          head: 'What we collect and why',
          items: [
            'Email, hashed password and name: for the account, sign-in and security.',
            'Interface language, market and platforms: for display and availability only, never for taste.',
            'What you marked as watched or not watched, and your list: to build triads, recommendations and the availability value.',
            'Ranking rounds and their replacements: to train your own taste model.',
            'Recommendations shown to you and what came of them: to close the loop and evaluate quality; aggregated after 24 months.',
            'Consents and privacy requests: a compliance record that stays, reduced to a trace without personal data after deletion.',
            'Audit log and server logs: for security and abuse prevention; server logs are kept for 30 days.',
          ],
        },
        {
          head: 'What we neither collect nor infer',
          paragraphs: [
            'No precise location, no device fingerprints or tracking cookies, no third-party advertising identifiers, no biometric or health data. And we never infer religion, politics, sexual orientation or health from what you watch or how you rank; this is a hard ban enforced in the explanation rules, the trait vocabulary and review.',
          ],
        },
        {
          head: 'Consents',
          items: [
            'Terms and privacy notice: at registration; required to use the service.',
            'Storing what you watched: at onboarding; required for the service to work.',
            'Your own taste model: at onboarding; required for the service to work; used for your profile only.',
            'Contributing to the shared model: optional, on by default with clear copy; your pseudonymous rankings, never attributed to you, help a shared model that improves triads and recommendations for everyone. Turning it off excludes your profile from the next retrain and does not affect your personal model.',
            'Product analytics: optional; operational events on our own systems only, no third party and no advertising.',
            'Import processing: asked when you import a list; the raw file is deleted after parsing.',
          ],
        },
        {
          head: 'Your rights',
          items: [
            'Wipe the taste profile: available now from your profile; deletes rounds, marks and the model and keeps the account.',
            'Change the optional consents: available now from your profile.',
            'Access and export: available now from your profile; after confirming your password, you can download a portable JSON copy of your account, profiles and privacy requests.',
            'Deletion: available now from your profile after confirming your password. The request pauses processing for your profiles and sets an execution date after a safety period; you can cancel until that date, and deletion cannot be undone after it runs.',
            'Correction: source data through support; taste corrections through a new ranking round, since originals are never edited in place.',
            'Objecting to automated decisions: recommendations are suggestions, and nothing is withheld from you by an automated decision.',
          ],
        },
        {
          head: 'Who else processes data',
          paragraphs: [
            'We use a language-model provider to describe films and rephrase explanations; only film evidence is sent: no user ids, emails, rankings, preferences, watch history or profile text.',
            'Film data and availability providers receive content data, not personal data, with one exception we state plainly: film posters are fetched by your browser straight from TMDB (image.tmdb.org) and never pass through our servers, so TMDB sees your IP address and your browser type, as any site you open does. It is not told who you are: a poster URL carries no identifier of yours, and the image is requested with no-referrer, so no page address goes with it. In the few places the same image is painted as a CSS backdrop, the browser’s own default sends our domain name and never the page path.',
            'We did not put an image proxy on our own domain because that would make us the ones redistributing TMDB’s images, a licensing question that is not settled. We will revisit it when it is.',
            'Hosting is Railway (servers and database in EU West) behind Cloudflare, with encrypted backups in a private European bucket.',
          ],
        },
        {
          head: 'Security',
          paragraphs: [
            'Encryption in transit and at rest, object-level authorization on every profile route, rate limits, an audit trail for every administrative action, and isolation of the model service from identity.',
          ],
        },
        {
          head: 'Retention',
          paragraphs: [
            'Account and taste data stay until deletion or a wipe. Recommendations shown and their outcomes: 24 months, then aggregated. Server logs: 30 days. Consents and privacy requests stay as a compliance record without personal data after deletion.',
          ],
        },
        {
          head: 'Contact',
          paragraphs: ['The privacy contact channel will be published on this page before launch.'],
        },
      ],
    },
  },
};
