const fs = require('fs')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType, ShadingType,
  TableOfContents, PageNumber, Header, Footer, PageBreak, VerticalAlign,
} = require('docx')

const GREEN = '0E7A54', DARK = '151A23', GREY = '5F6B7E', LIGHT = 'E7F6EF', BORDER = 'CCCCCC'

// RTL paragraph helper
function P(runs, opts = {}) {
  if (typeof runs === 'string') runs = [new TextRun({ text: runs, rightToLeft: true, font: 'Arial', ...(opts.run || {}) })]
  return new Paragraph({ bidirectional: true, alignment: opts.align || AlignmentType.RIGHT, spacing: opts.spacing || { after: 120, line: 300 }, ...opts.p, children: runs })
}
function R(text, o = {}) { return new TextRun({ text, rightToLeft: true, font: 'Arial', ...o }) }
function H(text, level) {
  return new Paragraph({ heading: level, bidirectional: true, alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text, rightToLeft: true, font: 'Arial' })] })
}
function bullet(text, opts = {}) {
  return new Paragraph({ numbering: { reference: opts.ref || 'bul', level: 0 }, bidirectional: true,
    alignment: AlignmentType.RIGHT, spacing: { after: 80, line: 290 },
    children: Array.isArray(text) ? text : [new TextRun({ text, rightToLeft: true, font: 'Arial' })] })
}
function cell(text, { fill, bold, w, header } = {}) {
  const runs = (Array.isArray(text) ? text : [text]).map(t =>
    typeof t === 'string' ? new TextRun({ text: t, rightToLeft: true, font: 'Arial', bold: !!bold, color: header ? 'FFFFFF' : '222222', size: 20 }) : t)
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: { fill: fill || 'FFFFFF', type: ShadingType.CLEAR },
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    verticalAlign: VerticalAlign.CENTER,
    borders: { top: bd, bottom: bd, left: bd, right: bd },
    children: [new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { after: 0, line: 270 }, children: runs })],
  })
}
const bd = { style: BorderStyle.SINGLE, size: 1, color: BORDER }

function table(rows, widths) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    visuallyRightToLeft: true,
    rows,
  })
}

const children = []

// ── Cover ──
children.push(new Paragraph({ spacing: { before: 2600, after: 0 }, alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: 'AI DEBT OS', bold: true, size: 64, color: GREEN, font: 'Arial' })] }))
children.push(new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, spacing: { before: 200, after: 0 },
  children: [new TextRun({ text: 'خطة سياسات المشاريع والشركات (Company Playbooks)', bold: true, size: 36, rightToLeft: true, font: 'Arial' })] }))
children.push(new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, spacing: { before: 160 },
  children: [new TextRun({ text: 'وكيل تحصيل متخصّص حسب كل شركة ومشروع', size: 26, color: GREY, rightToLeft: true, font: 'Arial' })] }))
children.push(new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, spacing: { before: 1200 },
  children: [new TextRun({ text: 'وثيقة خطة وتصميم — يونيو 2026', size: 22, color: GREY, rightToLeft: true, font: 'Arial' })] }))
children.push(new Paragraph({ children: [new PageBreak()] }))

// ── TOC ──
children.push(H('المحتويات', HeadingLevel.HEADING_1))
children.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }))
children.push(new Paragraph({ children: [new PageBreak()] }))

// ── 1. Executive summary ──
children.push(H('١. الملخص التنفيذي', HeadingLevel.HEADING_1))
children.push(P('الهدف: تحويل وكيل التحصيل من وكيل عام إلى محصّل متخصّص يتغيّر "عقله" حسب الشركة/المشروع الذي تخص المديونية. لكل جهة دائنة ملف سياسة مستقل (Playbook) يُحقن في تعليمات الوكيل قبل كل رد، فيقرّر بناءً على سياسة الشركة الصحيحة فقط.'))
children.push(P([R('المبدأ الجوهري: '), R('الوكيل لا يفترض أسباب المطالبة أبداً، بل يقرأها من المستندات (نجم، تقرير الحادث، المرفقات). وعند اعتراض العميل أو إرسال مستند، يفتح مراجعة ولا يضغط ولا يغلق المطالبة من نفسه.', { bold: true })]))

// ── 2. Insurance concepts ──
children.push(H('٢. مفاهيم مطالبات التأمين', HeadingLevel.HEADING_1))
children.push(P('قبل بناء النظام، هذه المفاهيم الأربعة الأساسية التي يجب أن يفهمها الوكيل في مشاريع شركات التأمين:'))
children.push(table([
  new TableRow({ tableHeader: true, children: [
    cell('المصطلح', { fill: GREEN, header: true, bold: true, w: 2000 }),
    cell('التعريف الدقيق', { fill: GREEN, header: true, bold: true, w: 4600 }),
    cell('الشرط الأساسي', { fill: GREEN, header: true, bold: true, w: 2760 }),
  ]}),
  new TableRow({ children: [
    cell('حق الرجوع', { bold: true, fill: LIGHT, w: 2000 }),
    cell('المتسبب لديه تأمين لكنه خالف شروط الوثيقة، فالشركة عوّضت المتضرر ثم ترجع عليه لاسترداد المبلغ.', { w: 4600 }),
    cell('يوجد تأمين + حادث + تعويض + سبب رجوع مُثبت في نجم.', { w: 2760 }),
  ]}),
  new TableRow({ children: [
    cell('طرف ثالث', { bold: true, fill: LIGHT, w: 2000 }),
    cell('المتسبب لا يملك تأميناً ساري وعليه نسبة خطأ، فالشركة تعوّض المتضرر ثم تطالبه.', { w: 4600 }),
    cell('لا يوجد تأمين ساري + نسبة خطأ.', { w: 2760 }),
  ]}),
  new TableRow({ children: [
    cell('حذف مسترد', { bold: true, fill: LIGHT, w: 2000 }),
    cell('مطالبة صُنّفت بسبب معيّن (مثل: لا يملك رخصة) ثم أحضر العميل مستنداً يعارض السبب، فتُراجَع أو يُسقط السبب؛ وإن عادت للتعامل تُسمّى "حذف مسترد".', { w: 4600 }),
    cell('وجود مستند يعارض سبب المطالبة.', { w: 2760 }),
  ]}),
  new TableRow({ children: [
    cell('غير واضح', { bold: true, fill: LIGHT, w: 2000 }),
    cell('لا توجد بيانات كافية لتحديد نوع المطالبة أو سببها.', { w: 4600 }),
    cell('يُصنّف "يحتاج مراجعة ملف" بلا رد حاسم.', { w: 2760 }),
  ]}),
], [2000, 4600, 2760]))

children.push(P([R('الفرق الجوهري: ', { bold: true }), R('حق الرجوع = يوجد تأمين لكن مخالفة للوثيقة. طرف ثالث = لا يوجد تأمين ساري.')], { spacing: { before: 160, after: 120 } }))
children.push(H('أسباب حق الرجوع', HeadingLevel.HEADING_2))
children.push(P('كلها يجب أن تكون مُثبتة في أوراق نجم أو ملف الحادث، ولا تُفترض:'))
;['لا يملك رخصة', 'رخصة منتهية', 'هروب من موقع الحادث', 'تفحيط', 'القيادة تحت تأثير', 'استخدام غير مصرّح به', 'مخالفة شروط الوثيقة']
  .forEach(s => children.push(bullet(s)))

// ── 3. Golden rules ──
children.push(H('٣. القاعدة الذهبية للوكيل', HeadingLevel.HEADING_1))
;[
  'لا يفترض السبب أبداً — يقرأه من نجم/التقرير/المرفقات/الإفادات.',
  'لا يقول "المطالبة صحيحة" لمجرد وجود مبلغ — يجب أن يعرف لماذا تطالب الشركة (حق رجوع؟ طرف ثالث؟ حذف مسترد؟).',
  'إذا اعترض العميل أو أرسل مستنداً: يسجّله، يفتح مراجعة، لا يضغط، لا يغلق المطالبة وحده، ويطلب مطابقة المستند بتاريخ الحادث.',
  'إذا كانت البيانات ناقصة: يصنّفها "تحتاج مراجعة ملف" بلا رد حاسم.',
  'لا يقرّر سقوط الدين دون مستند واضح.',
].forEach(s => children.push(bullet(s)))
children.push(P([R('ملاحظة: ', { bold: true }), R('بنية الاعتراضات وموافقة الإدارة الموجودة حالياً في النظام هي بالضبط آلية "الحذف المسترد / مراجعة سبب الرجوع"، وسنبني عليها.')], { spacing: { before: 140 } }))

// ── 4. Architecture ──
children.push(H('٤. المعمارية: سياسات المشاريع (Company Playbooks)', HeadingLevel.HEADING_1))
children.push(P('نفس الوكيل، لكن عقله يتغيّر حسب الشركة. لكل جهة دائنة (محفظة/مشروع) ملف سياسة يُحمَّل قبل الرد. عند دخول مديونية أو رسالة: النظام يعرف الشركة، يحمّل سياستها، يقرأ بيانات العميل وسجله والسياسة، ثم يقرّر الوكيل بناءً على السياسة الصحيحة فقط، ويسجّل القرار.'))
children.push(H('محتوى كل سياسة', HeadingLevel.HEADING_2))
;[
  'اسم الشركة + نوع المشروع + وصف العمل.',
  'الحقول المهمة (لشركة التأمين: رقم المطالبة، رقم الحادث، نجم، نسبة الخطأ، تاريخ الحادث، نوع المطالبة).',
  'أنواع المطالبات وطريقة التصنيف.',
  'متى يرد الوكيل / متى لا يرد / متى يفتح اعتراض / متى يطلب إثبات / متى يصعّد لموظف.',
  'نبرة الرد المطلوبة + الكلمات الممنوعة.',
  'قوالب الرد + الخطوات التشغيلية.',
].forEach(s => children.push(bullet(s)))

children.push(H('أمثلة سياسات الشركات', HeadingLevel.HEADING_2))
children.push(table([
  new TableRow({ tableHeader: true, children: [
    cell('الشركة / المشروع', { fill: GREEN, header: true, bold: true, w: 2400 }),
    cell('أبرز ما تشمله السياسة', { fill: GREEN, header: true, bold: true, w: 6960 }),
  ]}),
  ...[
    ['شركات التأمين', 'حق الرجوع، الطرف الثالث، الحذف المسترد، نجم، وثيقة التأمين، إثبات الرخصة، الاعتراضات والمراجعات.'],
    ['STC', 'نوع المطالبة، آلية التواصل، متى يُرسل SMS، متى يُصعّد، التعامل مع الاعتراض، متى يُعتبر الرقم خطأ، متى تُغلق الحالة.'],
    ['موبايلي', 'صيغة المطالبة، خطوات التحقق، الحالات المسموحة، مواعيد المتابعة، أسلوب الرد.'],
    ['الكهرباء / السعودية للطاقة', 'رقم الحساب، رقم العداد، المدينة، حالة الفاتورة، اعتراضات الفواتير، إثبات السداد، متى تُرفع مراجعة.'],
    ['علم / تم', 'نوع الخدمة، رقم الهوية أو المنشأة، رقم العملية، طريقة التحقق، الحالات التي تحتاج إحالة.'],
  ].map(([a, b]) => new TableRow({ children: [cell(a, { bold: true, fill: LIGHT, w: 2400 }), cell(b, { w: 6960 })] })),
], [2400, 6960]))

// ── 5. Implementation phases ──
children.push(new Paragraph({ children: [new PageBreak()] }))
children.push(H('٥. خطة التطبيق (مراحل)', HeadingLevel.HEADING_1))
children.push(table([
  new TableRow({ tableHeader: true, children: [
    cell('المرحلة', { fill: GREEN, header: true, bold: true, w: 2400 }),
    cell('المحتوى', { fill: GREEN, header: true, bold: true, w: 4760 }),
    cell('يبني على', { fill: GREEN, header: true, bold: true, w: 2200 }),
  ]}),
  ...[
    ['١. قاعدة البيانات', 'جدول playbooks (سياسة لكل شركة) + حقول للديون: نوع المطالبة، سبب المطالبة، رقم نجم، نسبة الخطأ، تاريخ الحادث، وجود تأمين ساري.', 'المحافظ الموجودة'],
    ['٢. واجهة إدارة السياسات', 'صفحة "سياسات المشاريع": إضافة/تعديل سياسة كل شركة (النبرة، القوالب، قواعد التصعيد، الكلمات الممنوعة).', '—'],
    ['٣. ربط الوكيل بالسياسة', 'الوكيل يحمّل سياسة جهة العميل (عبر المحفظة/الدائن) ويحقنها في "ملف القضية" والتعليمات.', 'محرك الوكيل'],
    ['٤. منطق التأمين', 'تصنيف المطالبة، قاعدة "لا تفترض السبب"، مراجعة مدفوعة بالمستندات.', 'بنية الاعتراضات'],
    ['٥. تخصيص لكل شركة', 'قوالب رد + قواعد تصعيد + كلمات ممنوعة لكل سياسة.', '—'],
    ['٦. التدريب والاختبار', 'سيناريوهات اختبار لكل سياسة (رسالة عميل ← التحقق من تصنيف الوكيل ورده وتصعيده).', 'صفحة اختبار الردود'],
  ].map(([a, b, c]) => new TableRow({ children: [cell(a, { bold: true, fill: LIGHT, w: 2400 }), cell(b, { w: 4760 }), cell(c, { w: 2200 })] })),
], [2400, 4760, 2200]))

// ── 6. Training ──
children.push(H('٦. تدريب الوكيل والاختبار', HeadingLevel.HEADING_1))
;[
  'حقن السياسة في تعليمات الوكيل (قسم "سياسة الشركة" يُحمّل من ملف السياسة) بجانب القواعد الصارمة وملف القضية الموجودين.',
  'سيناريوهات اختبار لكل شركة: نحاكي رسائل عملاء ونتأكد أن الوكيل يصنّف صح، يفتح مراجعة بدل الضغط، يطلب مطابقة المستند بتاريخ الحادث، ويصعّد عند الحاجة.',
  'التكرار: مراقبة المحادثات الفعلية وضبط السياسة دورياً.',
].forEach(s => children.push(bullet(s)))

children.push(H('مثال تطبيقي', HeadingLevel.HEADING_2))
children.push(P([R('نفس جملة العميل: ', { bold: true }), R('«عندي رخصة وقت الحادث».')]))
children.push(bullet('في مشروع شركة تأمين: الوكيل يفهمها كـ "حذف مسترد محتمل" ← يفتح مراجعة ويطلب مطابقة الرخصة بتاريخ الحادث.'))
children.push(bullet('في مشروع STC: غير مرتبطة بالتأمين ← يطلب توضيحاً أو يصعّدها لموظف.'))

// ── 7. Next steps ──
children.push(H('٧. الخطوات التالية', HeadingLevel.HEADING_1))
;[
  'البدء بالمرحلة ١ (قاعدة البيانات + حقول المطالبة) ثم المرحلة ٣ (ربط الوكيل بالسياسة) لأنهما القلب.',
  'تزويد النظام بسياسات الشركات الأخرى الجاهزة (STC / موبايلي / كهرباء) لتضمينها.',
  'بناء واجهة إدارة السياسات لتمكين الإدارة من تعديلها دون برمجة.',
  'إعداد سيناريوهات اختبار لكل سياسة قبل التشغيل الفعلي.',
].forEach(s => children.push(bullet(s)))

const doc = new Document({
  creator: 'AI DEBT OS',
  title: 'خطة سياسات المشاريع',
  styles: {
    default: { document: { run: { font: 'Arial', size: 24 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: GREEN },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: '0B5A40' },
        paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [
    { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.RIGHT,
      style: { paragraph: { indent: { right: 720, hanging: 280 } } } }] },
  ]},
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true,
      children: [new TextRun({ text: 'AI DEBT OS — خطة سياسات المشاريع — صفحة ', rightToLeft: true, font: 'Arial', size: 18, color: GREY }),
        new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 18, color: GREY })] })] }) },
    children,
  }],
})

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('D:/ai-debt-os-admin/Company_Playbooks_Plan_AR.docx', buf)
  console.log('written, bytes:', buf.length)
})
