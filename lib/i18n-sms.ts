// Multilingual SMS template renderer. Stays minimal: one map per
// template name × language with positional {0}, {1}, {2}… placeholders.
// Defaults to English when the rider's preferred language isn't in the
// map — never silently uses a wrong language.
//
// Adding a language:
//   1. Add the ISO 639-1 code to LANGS below.
//   2. Add translations for every template under TEMPLATES.
//   3. Re-submit your DLT registration with the translated body — TRAI
//      doesn't accept dynamic translation of a single registered template.
//      Each (language, template) pair must be registered separately.
//
// In production every language above English needs its own DLT template
// ID. The DLT routing happens at the Twilio level (template ID in the
// SMS body); from this module's POV we just render the right text.

export const SMS_LANGS = ["en", "hi", "ta", "te", "bn", "mr", "gu", "kn", "ml", "pa"] as const;
export type SmsLang = (typeof SMS_LANGS)[number];

export type SmsTemplateKey =
  | "invoice_due_soon"
  | "payment_received"
  | "absence_streak"
  | "birthday"
  | "exam_result";

// Each template stores a positional list of replacements. The route caller
// passes args in the same order; render() substitutes {0}, {1}, etc.
// Lengths kept under ~160 chars to fit a single SMS segment.
const TEMPLATES: Record<SmsTemplateKey, Record<SmsLang, string>> = {
  invoice_due_soon: {
    en: "Equiwings: Rs.{0} fee for {1} is due in {2} day(s). Pay via the link sent earlier or visit the centre.",
    hi: "Equiwings: {1} के लिए Rs.{0} शुल्क {2} दिन में देय है। पहले भेजे गए लिंक से भुगतान करें या केंद्र पर आएं।",
    ta: "Equiwings: {1} க்கான Rs.{0} கட்டணம் {2} நாட்களில் செலுத்தப்பட வேண்டும். முன்பு அனுப்பிய இணைப்பு மூலம் செலுத்துங்கள்.",
    te: "Equiwings: {1} కోసం Rs.{0} ఫీజు {2} రోజుల్లో చెల్లించాలి. మునుపు పంపిన లింక్ ద్వారా చెల్లించండి.",
    bn: "Equiwings: {1} এর জন্য Rs.{0} ফি {2} দিনের মধ্যে পরিশোধ করতে হবে। আগের লিংকে পেমেন্ট করুন।",
    mr: "Equiwings: {1} साठी Rs.{0} शुल्क {2} दिवसांत भरायचे आहे. आधी पाठवलेल्या लिंकने पैसे भरा.",
    gu: "Equiwings: {1} માટે Rs.{0} ફી {2} દિવસમાં ચૂકવવાની છે. પહેલા મોકલેલી લિંકથી ચૂકવો.",
    kn: "Equiwings: {1} ಗಾಗಿ Rs.{0} ಶುಲ್ಕ {2} ದಿನಗಳಲ್ಲಿ ಪಾವತಿಸಬೇಕು. ಮೊದಲು ಕಳುಹಿಸಿದ ಲಿಂಕ್ ಮೂಲಕ ಪಾವತಿಸಿ.",
    ml: "Equiwings: {1} ന് Rs.{0} ഫീസ് {2} ദിവസത്തിനുള്ളിൽ അടയ്ക്കണം. മുമ്പ് അയച്ച ലിങ്കിലൂടെ പണമടയ്ക്കുക.",
    pa: "Equiwings: {1} ਲਈ Rs.{0} ਫੀਸ {2} ਦਿਨਾਂ ਵਿੱਚ ਅਦਾ ਕਰਨੀ ਹੈ। ਪਹਿਲਾਂ ਭੇਜੇ ਲਿੰਕ ਤੋਂ ਅਦਾ ਕਰੋ।",
  },
  payment_received: {
    en: "{0}: Thank you. Rs.{1} {2} fee for {3} received. Ref: {4}.",
    hi: "{0}: धन्यवाद। {3} के लिए Rs.{1} {2} शुल्क प्राप्त हुआ। संदर्भ: {4}।",
    ta: "{0}: நன்றி. {3} க்கான Rs.{1} {2} கட்டணம் பெறப்பட்டது. குறிப்பு: {4}.",
    te: "{0}: ధన్యవాదాలు. {3} కోసం Rs.{1} {2} ఫీజు అందుకున్నాము. రెఫ్: {4}.",
    bn: "{0}: ধন্যবাদ। {3} এর জন্য Rs.{1} {2} ফি গৃহীত। রেফ: {4}।",
    mr: "{0}: धन्यवाद. {3} साठी Rs.{1} {2} शुल्क मिळाले. संदर्भ: {4}.",
    gu: "{0}: આભાર. {3} માટે Rs.{1} {2} ફી મળી. સંદર્ભ: {4}.",
    kn: "{0}: ಧನ್ಯವಾದಗಳು. {3} ಗಾಗಿ Rs.{1} {2} ಶುಲ್ಕ ಸ್ವೀಕರಿಸಲಾಗಿದೆ. ರೆಫ್: {4}.",
    ml: "{0}: നന്ദി. {3} ന് Rs.{1} {2} ഫീസ് സ്വീകരിച്ചു. റെഫ്: {4}.",
    pa: "{0}: ਧੰਨਵਾਦ। {3} ਲਈ Rs.{1} {2} ਫੀਸ ਮਿਲੀ। ਰੈਫ਼: {4}।",
  },
  absence_streak: {
    en: "Equiwings: {0} has been absent for 3+ recent sessions. Please contact the centre. Continued absences may risk membership.",
    hi: "Equiwings: {0} पिछले 3+ सत्रों से अनुपस्थित है। कृपया केंद्र से संपर्क करें। बार-बार अनुपस्थित रहने पर सदस्यता रद्द हो सकती है।",
    ta: "Equiwings: {0} சமீபத்திய 3+ அமர்வுகளுக்கு வரவில்லை. மையத்தைத் தொடர்பு கொள்ளவும். தொடர் வரவில்லை இருந்தால் உறுப்பினர் ரத்து ஆகலாம்.",
    te: "Equiwings: {0} గత 3+ సెషన్లకు రాలేదు. కేంద్రాన్ని సంప్రదించండి. తరచుగా రాకపోతే సభ్యత్వం రద్దు అవ్వవచ్చు.",
    bn: "Equiwings: {0} সাম্প্রতিক 3+ সেশন অনুপস্থিত। অনুগ্রহ করে কেন্দ্রে যোগাযোগ করুন।",
    mr: "Equiwings: {0} गेल्या 3+ सत्रांत अनुपस्थित आहे. कृपया केंद्राशी संपर्क करा.",
    gu: "Equiwings: {0} છેલ્લા 3+ સત્રોમાં ગેરહાજર. કૃપા કરી કેન્દ્રનો સંપર્ક કરો.",
    kn: "Equiwings: {0} ಇತ್ತೀಚಿನ 3+ ಅವಧಿಗಳಲ್ಲಿ ಗೈರಾಗಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ಕೇಂದ್ರವನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    ml: "Equiwings: {0} കഴിഞ്ഞ 3+ സെഷനുകളിൽ ഹാജരല്ല. കേന്ദ്രവുമായി ബന്ധപ്പെടുക.",
    pa: "Equiwings: {0} ਪਿਛਲੇ 3+ ਸੈਸ਼ਨਾਂ ਵਿੱਚ ਗ਼ੈਰਹਾਜ਼ਰ। ਕਿਰਪਾ ਕਰਕੇ ਸੈਂਟਰ ਨਾਲ ਸੰਪਰਕ ਕਰੋ।",
  },
  birthday: {
    en: "Happy Birthday {0}! Wishing you a wonderful {1}th year — see you at the stables. — Team Equiwings",
    hi: "जन्मदिन की शुभकामनाएँ {0}! आपके {1}वें वर्ष की हार्दिक शुभकामनाएँ — मिलते हैं अस्तबल पर। — Team Equiwings",
    ta: "பிறந்தநாள் வாழ்த்துகள் {0}! {1}வது வயதில் சிறப்பான ஆண்டாக அமைய வாழ்த்துகிறோம். — Team Equiwings",
    te: "పుట్టినరోజు శుభాకాంక్షలు {0}! {1}వ సంవత్సరం అద్భుతంగా ఉండాలి. — Team Equiwings",
    bn: "শুভ জন্মদিন {0}! {1}তম বছর সুন্দর হোক। — Team Equiwings",
    mr: "वाढदिवसाच्या शुभेच्छा {0}! {1}वा वर्ष आनंदाचा जाओ. — Team Equiwings",
    gu: "જન્મદિવસની શુભેચ્છાઓ {0}! {1}મું વર્ષ સુખદ થાય. — Team Equiwings",
    kn: "ಜನ್ಮದಿನದ ಶುಭಾಶಯಗಳು {0}! {1}ನೇ ವರ್ಷ ಶ್ರೇಷ್ಠವಾಗಲಿ. — Team Equiwings",
    ml: "ജന്മദിനാശംസകൾ {0}! {1}ാം വർഷം മികച്ചതാകട്ടെ. — Team Equiwings",
    pa: "ਜਨਮ ਦਿਨ ਮੁਬਾਰਕ {0}! {1}ਵਾਂ ਸਾਲ ਖੁਸ਼ੀਆਂ ਭਰਿਆ ਹੋਵੇ। — Team Equiwings",
  },
  exam_result: {
    en: "Equiwings: {0} {1} their Level {2} exam. Score: {3}. — Team Equiwings",
    hi: "Equiwings: {0} ने Level {2} परीक्षा {1}। अंक: {3}। — Team Equiwings",
    ta: "Equiwings: {0} Level {2} தேர்வில் {1}. மதிப்பெண்: {3}. — Team Equiwings",
    te: "Equiwings: {0} Level {2} పరీక్షలో {1}. మార్కులు: {3}. — Team Equiwings",
    bn: "Equiwings: {0} Level {2} পরীক্ষায় {1}. স্কোর: {3}. — Team Equiwings",
    mr: "Equiwings: {0} Level {2} परीक्षा {1}. गुण: {3}. — Team Equiwings",
    gu: "Equiwings: {0} એ Level {2} પરીક્ષા {1}. સ્કોર: {3}. — Team Equiwings",
    kn: "Equiwings: {0} Level {2} ಪರೀಕ್ಷೆಯಲ್ಲಿ {1}. ಸ್ಕೋರ್: {3}. — Team Equiwings",
    ml: "Equiwings: {0} Level {2} പരീക്ഷയിൽ {1}. സ്കോർ: {3}. — Team Equiwings",
    pa: "Equiwings: {0} ਨੇ Level {2} ਪ੍ਰੀਖਿਆ {1}. ਅੰਕ: {3}. — Team Equiwings",
  },
};

export function renderSmsTemplate(
  key: SmsTemplateKey,
  lang: string | null | undefined,
  args: (string | number)[],
): string {
  const l = (lang ?? "en").toLowerCase() as SmsLang;
  const dict = TEMPLATES[key];
  const tpl = (SMS_LANGS as readonly string[]).includes(l) ? dict[l as SmsLang] : dict.en;
  return tpl.replace(/\{(\d+)\}/g, (_, n) => String(args[Number(n)] ?? ""));
}
