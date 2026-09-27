// Arabic / English for WiFi Palace POS.
// Screens are written in English; when Arabic is chosen this layer switches the page to right-to-left
// and replaces known labels, buttons, headings and placeholders. Names, amounts, receipts (<pre>) and
// anything typed by the user are never changed. The language is a per-device choice.
(function(root){
 'use strict';
 const AR={
  // navigation and shell
  'Dashboard':'الرئيسية','Checkout':'الدفع','Appointments':'المواعيد','Customers':'العملاء','Sales':'المبيعات','Services & staff':'الخدمات والموظفون','Settings':'الإعدادات','Finance':'المالية','Team':'الفريق','Sync centre':'مركز المزامنة','Account':'الحساب',
  // gym
  'Check-in':'الحضور','Sell':'بيع','Members':'الأعضاء','Check-in desk':'مكتب الحضور','Check in':'تسجيل حضور','Use PT session':'استخدام جلسة تدريب','Renew / sell plan':'تجديد / بيع اشتراك','Unfreeze':'إلغاء التجميد','Freeze':'تجميد','Freeze from today':'تجميد من اليوم','Membership plans':'باقات الاشتراك','Personal training':'التدريب الشخصي','Products':'المنتجات','Trainers':'المدربون','+ Add member':'+ إضافة عضو','+ New member':'+ عضو جديد','+ Add new member':'+ إضافة عضو جديد','Member':'العضو','Membership starts':'بداية الاشتراك','Trainer':'المدرب','Renew':'تجديد','Renew / add':'تجديد / إضافة','Active':'نشط','Expired':'منتهي','Frozen':'مجمد','Upcoming':'قادم','Expiring':'ينتهي قريباً','No membership':'بدون اشتراك','Active members':'الأعضاء النشطون','Check-ins today':'الحضور اليوم','Expiring in 7 days':'ينتهي خلال 7 أيام','Expiring soon':'ينتهي قريباً','Recent check-ins':'آخر الحضور','PT sessions':'جلسات التدريب','Member card':'بطاقة العضوية','Add':'إضافة','✓ Added':'✓ تمت الإضافة','Record session':'تسجيل الجلسة','Print card':'طباعة البطاقة','Today':'اليوم','Sale':'البيع','New member':'عضو جديد','Edit member':'تعديل العضو','Add member':'إضافة عضو','Full name':'الاسم الكامل','Allow once (owner)':'السماح مرة واحدة (المالك)','Check-in desk →':'مكتب الحضور ←','Stronger every day.':'أقوى كل يوم.','Expired in the last 30 days':'انتهى خلال آخر 30 يوماً','Search name, mobile or member code':'ابحث بالاسم أو الجوال أو رقم العضو','Membership plan':'باقة اشتراك','Personal training pack':'باقة تدريب شخصي','Product':'منتج','Add trainer':'إضافة مدرب','Edit trainer':'تعديل المدرب',
  'Including frozen':'يشمل المجمّدة','Not yet renewed':'لم يُجدَّد بعد','No memberships ending in the next 7 days.':'لا توجد اشتراكات تنتهي خلال 7 أيام.','Nobody to win back right now.':'لا يوجد أعضاء لاستعادتهم حالياً.','No check-ins yet today.':'لا يوجد حضور اليوم بعد.','No check-ins yet.':'لا يوجد حضور بعد.',
  'Trends':'الاتجاهات','Check-ins':'الحضور','14 days':'14 يوماً','30 days':'30 يوماً','Show as table':'عرض كجدول','Day':'اليوم',
  'Orders received':'الطلبات المستلمة','Receipts':'الإيصالات',
  // reports and account recovery
  'Reports':'التقارير','Show report':'عرض التقرير','Bill details':'تفاصيل الفاتورة','Bills':'الفواتير','Items':'العناصر','Net sales before tax':'صافي المبيعات قبل الضريبة','Sales before discount':'المبيعات قبل الخصم','Discounts':'الخصومات','Refunds after discount':'المرتجعات بعد الخصم','Net sales':'صافي المبيعات','From':'من','To':'إلى','Forgot password?':'نسيت كلمة المرور؟','Forgot business code?':'نسيت رمز النشاط؟',
  
  'WiFi Palace POS':'واي فاي بالاس POS','POINT OF SALE':'نقاط البيع','SALON & SPA':'صالون وسبا','LAUNDRY':'مغسلة','GROCERY & BAQALA':'بقالة','RESTAURANT & CAFÉ':'مطعم ومقهى','GYM & FITNESS':'نادي رياضي',
  'Cloud edition':'النسخة السحابية','New order':'طلب جديد','+ New order':'+ طلب جديد','Orders':'الطلبات','Price list':'قائمة الأسعار','Laundry orders':'طلبات الغسيل','New laundry order':'طلب غسيل جديد','Ready for pickup':'جاهز للاستلام','In progress':'قيد التنفيذ','Overdue':'متأخر','Received':'مستلم','Washing':'قيد الغسيل','Ready':'جاهز','Delivered':'تم التسليم','Cancelled':'ملغى','Open':'مفتوحة','Take payment':'استلام الدفع','Hand over':'تسليم','Ticket':'التذكرة','Print ticket':'طباعة التذكرة','Save item':'حفظ الصنف','+ Add item':'+ إضافة صنف','Fresh and ready.':'نظيف وجاهز.','Ready by':'جاهز بتاريخ','Customer name':'اسم العميل','Mobile (for WhatsApp)':'الجوال (لواتساب)','Notes (stains, starch, folding)':'ملاحظات (بقع، نشا، طي)','Save · pay on pickup':'حفظ · الدفع عند الاستلام','Save & take payment':'حفظ واستلام الدفع','Confirm payment':'تأكيد الدفع','Express':'مستعجل','Normal':'عادي','Kilos':'كيلو','All':'الكل','Take payment →':'الدفع ←','pending':'معلّق','Walk-in customer':'عميل بدون حجز','Sync now':'مزامنة الآن','Cloud connected':'متصل بالسحابة','Owner':'المالك','Cashier':'أمين الصندوق','Cancel':'إلغاء','Close':'إغلاق','Edit':'تعديل','Delete':'حذف','Retry':'إعادة المحاولة','Status':'الحالة','Actions':'الإجراءات',
  // login
  'WIFI PALACE POS':'واي فاي بالاس POS','Your business.':'عملك.','Connected.':'متصل.','One workspace for your team, your customers and every sale.':'مساحة عمل واحدة لفريقك وعملائك وكل عملية بيع.',
  'A private workspace for each business':'مساحة عمل خاصة لكل نشاط تجاري','Offline billing with cloud sync':'فوترة دون إنترنت مع مزامنة سحابية','Owner access from anywhere':'وصول المالك من أي مكان',
  'Welcome back':'مرحباً بعودتك','Sign in to your business workspace.':'سجّل الدخول إلى مساحة عملك.','Business code':'رمز النشاط التجاري','Email':'البريد الإلكتروني','Password':'كلمة المرور','Sign in →':'تسجيل الدخول ←','Continue on this device offline':'المتابعة على هذا الجهاز دون إنترنت',
  // dashboard
  'A beautiful day for business.':'يوم جميل للعمل.','Today’s net collections':'صافي تحصيل اليوم','After today’s refunds':'بعد مرتجعات اليوم','Receipts today':'إيصالات اليوم','All completed payments':'جميع المدفوعات المكتملة','Bookings today':'حجوزات اليوم','Scheduled appointments':'المواعيد المجدولة','Customer directory':'دليل العملاء','Customers saved':'العملاء المحفوظون',
  'Today’s appointments':'مواعيد اليوم','View all →':'عرض الكل ←','A little room in the diary.':'لا يزال في الجدول متسع.','Add a booking to plan your team’s day.':'أضف حجزاً لتنظيم يوم فريقك.','+ Book appointment':'+ حجز موعد','Recent activity':'آخر النشاطات','Your first sale starts a new story.':'أول عملية بيع تبدأ قصة جديدة.','Completed bills will appear here.':'ستظهر الفواتير المكتملة هنا.',
  'Quick actions':'إجراءات سريعة','New sale':'بيع جديد','+ New sale':'+ بيع جديد','Add customer':'إضافة عميل','Manage services':'إدارة الخدمات','Salon setup':'إعداد الصالون','Most-loved services':'الخدمات الأكثر طلباً','All time · non-refunded sales':'كل الأوقات · مبيعات غير مستردة','Your popular services will appear as you make sales.':'ستظهر خدماتك الأكثر طلباً مع المبيعات.',
  // checkout
  'Let’s make their day.':'لنجعل يومهم مميزاً.','Select services to start a new bill.':'اختر الخدمات لبدء فاتورة جديدة.','Search services…':'ابحث عن الخدمات…','Current bill':'الفاتورة الحالية','Your bill is empty.':'الفاتورة فارغة.','Customer':'العميل','Stylist':'المصفف','Discount (AED)':'الخصم (درهم)','Subtotal':'المجموع الفرعي','Discount':'الخصم','Total':'الإجمالي','Clear bill':'مسح الفاتورة','No matching services.':'لا توجد خدمات مطابقة.',
  'Complete payment':'إتمام الدفع','Total to collect':'المبلغ المطلوب','Payment method':'طريقة الدفع','Cash':'نقداً','Card':'بطاقة','Split':'تقسيم','Cash portion of bill (AED)':'الجزء النقدي (درهم)','Cash received (AED)':'النقد المستلم (درهم)','Confirm & save sale':'تأكيد وحفظ البيع',
  'Sale receipt':'إيصال البيع','Print / Save PDF':'طباعة / حفظ PDF','Save text':'حفظ كنص','Powered by WiFi Palace POS':'بواسطة واي فاي بالاس POS',
  // customers & appointments
  'Name':'الاسم','Phone':'الهاتف','Date of birth':'تاريخ الميلاد','Date of birth (optional)':'تاريخ الميلاد (اختياري)','Completed sales':'المبيعات المكتملة','Birthday today':'عيد ميلاد اليوم','Birthday WhatsApp':'تهنئة واتساب','No customers yet. Add your first regular.':'لا يوجد عملاء بعد. أضف أول عميل دائم.','Save customer':'حفظ العميل',
  'When':'الموعد','Service / stylist':'الخدمة / المصفف','WhatsApp':'واتساب','Complete':'إتمام','Book appointment':'حجز موعد','Service':'الخدمة','Date & time':'التاريخ والوقت','Duration (minutes)':'المدة (بالدقائق)','Save booking':'حفظ الحجز',
  'WhatsApp appointment':'موعد عبر واتساب','Message type':'نوع الرسالة','Cancellation':'إلغاء','Confirmation':'تأكيد','Reminder':'تذكير','Message':'الرسالة','Birthday message':'رسالة عيد الميلاد','Customer WhatsApp number':'رقم واتساب العميل','Review WhatsApp link':'مراجعة رابط واتساب',
  // sales
  'Sales & receipts':'المبيعات والإيصالات','Daily collections, refunds and your complete receipt history.':'التحصيل اليومي والمرتجعات وسجل الإيصالات الكامل.','Report date':'تاريخ التقرير','Collected':'المحصّل','Refunded':'المسترد','Refunds issued on selected date':'المرتجعات في التاريخ المحدد','Net collections (AED)':'صافي التحصيل (درهم)','Collections less refunds':'التحصيل ناقص المرتجعات','All receipts':'كل الإيصالات','Export CSV':'تصدير CSV','Receipt / date':'الإيصال / التاريخ','Payment':'الدفع','Receipt':'إيصال','Refund':'استرداد','Showing sales created by your account.':'عرض المبيعات التي أنشأها حسابك.',
  // services & staff
  'Services':'الخدمات','Your team':'فريقك','Assign a stylist to each sale and appointment.':'حدد مصففاً لكل عملية بيع وموعد.','Service name':'اسم الخدمة','Category':'الفئة','Price before tax (AED)':'السعر قبل الضريبة (درهم)','Save service':'حفظ الخدمة','Commission (%)':'العمولة (%)','Save stylist':'حفظ المصفف',
  // settings
  'MAKE IT YOURS':'اجعله خاصاً بك','Business & branding':'النشاط والهوية','Your salon’s identity, on every receipt.':'هوية صالونك على كل إيصال.','Salon profile':'ملف الصالون','Salon / business name':'اسم الصالون / النشاط','Contact number':'رقم التواصل','Tax registration number (TRN)':'رقم التسجيل الضريبي (TRN)','Enter your business TRN':'أدخل الرقم الضريبي','Business address':'العنوان','Street, area, city':'الشارع، المنطقة، المدينة','Tax rate (%)':'نسبة الضريبة (%)','Save business details':'حفظ بيانات النشاط',
  'Salon logo':'شعار الصالون','Shown in your workspace and on printed receipts.':'يظهر في مساحة العمل وعلى الإيصالات المطبوعة.','Upload your salon’s logo':'ارفع شعار صالونك','Choose salon logo':'اختيار الشعار','Remove logo':'إزالة الشعار',
  'Receipt printer · this device':'طابعة الإيصالات · هذا الجهاز','Printer IP address':'عنوان IP للطابعة','Paper width':'عرض الورق','Save printer':'حفظ الطابعة','Test print':'طباعة تجريبية','Language':'اللغة',
  'Backup & recovery':'النسخ الاحتياطي والاستعادة','Export full backup':'تصدير نسخة كاملة','Restore a backup':'استعادة نسخة','Choose backup file':'اختيار ملف النسخة','YOUR SOFTWARE PARTNER':'شريكك التقني','Sales & support':'المبيعات والدعم',
  // sync, account, team
  'EVERY CHANGE ACCOUNTED FOR':'كل تغيير محسوب','All saved changes are in the cloud.':'كل التغييرات المحفوظة موجودة في السحابة.','Export recovery copy':'تصدير نسخة استرداد','Review & discard pending changes':'مراجعة وتجاهل التغييرات المعلقة','Owner review required':'مطلوب مراجعة المالك','Owner email':'بريد المالك','Owner password':'كلمة مرور المالك','Approve discard':'الموافقة على التجاهل',
  'Your account':'حسابك','Change password':'تغيير كلمة المرور','Current password':'كلمة المرور الحالية','Sign out of this device':'تسجيل الخروج من هذا الجهاز','Device & cloud':'الجهاز والسحابة','Software by WiFi Palace':'برمجيات واي فاي بالاس',
  'THE RIGHT ACCESS FOR EVERY ROLE':'الصلاحية المناسبة لكل دور','Team accounts':'حسابات الفريق','Team access':'وصول الفريق','You':'أنت','Audit history':'سجل التدقيق','Load recent account & record changes':'تحميل آخر التغييرات','Create team login':'إنشاء حساب للفريق','Role':'الدور','Initial password':'كلمة المرور الأولى','Create login':'إنشاء الحساب','+ Add login':'+ إضافة حساب',
  // finance
  'OWNER REPORTS':'تقارير المالك','Finance & daily closing':'المالية والإغلاق اليومي','Refresh report':'تحديث التقرير','Business date':'تاريخ العمل','Stylist commissions':'عمولات المصففين','Set stylist rates':'تحديد نسب العمولة','Earned':'المستحق','Reversed':'المعكوس','Net':'الصافي','Expenses':'المصروفات','Amount':'المبلغ','Void':'إلغاء','Daily cash closing':'الإغلاق النقدي اليومي','Closing saved':'تم حفظ الإغلاق','Count & close day':'العد وإغلاق اليوم','Export daily report CSV':'تصدير التقرير اليومي CSV',
  'Record expense':'تسجيل مصروف','Date':'التاريخ','Description':'الوصف','Supplies':'مستلزمات','Rent':'إيجار','Utilities':'خدمات','Salary (excluding commissions)':'رواتب (دون العمولات)','Other':'أخرى','Amount (AED)':'المبلغ (درهم)','Paid from':'مدفوع من','Bank / card':'بنك / بطاقة','Save expense':'حفظ المصروف','Save closing':'حفظ الإغلاق','Closing notes / movement details':'ملاحظات الإغلاق'
 };
 // Receipt labels printed in both languages when the device language is Arabic.
 const RECEIPT={'TAX INVOICE':'فاتورة ضريبية','RECEIPT':'إيصال','PROVISIONAL RECEIPT':'إيصال مؤقت','Date':'التاريخ','Customer':'العميل','Staff':'الموظف','Subtotal (excl. VAT)':'المجموع قبل الضريبة','Discount':'الخصم','Taxable amount':'المبلغ الخاضع للضريبة','VAT':'ضريبة القيمة المضافة','TOTAL (incl. VAT)':'الإجمالي شامل الضريبة','Payment':'الدفع','Received':'المستلم','Change':'الباقي','All amounts in AED':'جميع المبالغ بالدرهم الإماراتي','Thank you for visiting!':'شكراً لزيارتكم!','REFUNDED':'مسترد','CREDIT NOTE':'إشعار دائن','TRN':'الرقم الضريبي'};
 const KEY='wifipos-lang';
 let lang='en';try{lang=localStorage.getItem(KEY)==='ar'?'ar':'en'}catch{}
 const SKIP=new Set(['PRE','SCRIPT','STYLE','TEXTAREA','CODE']);
 function translateNode(node){
  if(lang!=='ar')return;
  if(node.nodeType===3){const p=node.parentElement;if(!p||SKIP.has(p.tagName)||p.closest('[data-no-translate]'))return;const raw=node.nodeValue,t=raw.trim();if(t&&Object.hasOwn(AR,t))node.nodeValue=raw.replace(t,AR[t]);return}
  if(node.nodeType!==1||SKIP.has(node.tagName)||node.hasAttribute('data-no-translate'))return;
  for(const attr of ['placeholder','aria-label','title']){const v=node.getAttribute(attr);if(v&&Object.hasOwn(AR,v.trim()))node.setAttribute(attr,AR[v.trim()])}
  if(node.tagName==='OPTION'){const t=node.textContent.trim();if(Object.hasOwn(AR,t))node.textContent=AR[t];return}
  for(const child of node.childNodes)translateNode(child);
 }
 function apply(){
  document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
  if(lang==='ar')translateNode(document.body);
  const b=document.getElementById('langToggle');if(b)b.textContent=lang==='ar'?'English':'العربية';
 }
 function set(next){try{localStorage.setItem(KEY,next==='ar'?'ar':'en')}catch{}location.reload()}
 function toggleButton(){
  if(document.getElementById('langToggle'))return;const header=document.querySelector('header');if(!header)return;
  const b=document.createElement('button');b.id='langToggle';b.type='button';b.className='lang-toggle';b.setAttribute('data-no-translate','');
  b.onclick=()=>set(lang==='ar'?'en':'ar');header.appendChild(b);
 }
 const receiptLabel=en=>lang==='ar'&&Object.hasOwn(RECEIPT,en)?en+' / '+RECEIPT[en]:en;
 root.I18N={get lang(){return lang},set,receiptLabel,AR,RECEIPT};
 function init(){toggleButton();apply();new MutationObserver(list=>{if(lang!=='ar')return;for(const m of list){for(const n of m.addedNodes)translateNode(n);if(m.type==='characterData')translateNode(m.target)}}).observe(document.body,{childList:true,subtree:true,characterData:true})}
 if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init()}
})(globalThis);
