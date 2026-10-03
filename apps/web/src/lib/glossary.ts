/**
 * A reading glossary for the English translations.
 *
 * These are curated, hand-written reference entries, not generated prose: Ilm shows
 * scores, evidence spans and passages, and a dictionary that invented its own
 * definitions would break that claim. Each entry cites the verses it draws on, so
 * a reader can check any claim against the text.
 *
 * The term list came from a frequency analysis of the English translations, so it
 * covers the words a reader actually meets often instead of being a general
 * dictionary. Matching is whole-word and case-insensitive unless an entry is marked
 * caseSensitive, which is how the prophet Lot is kept apart from "a lot".
 *
 * Variants that are too ordinary to be a reliable signal - light, good, know,
 * trust, raised - are deliberately absent. Highlighting them would mark most of a
 * page and mean nothing.
 */

export type GlossaryCategory =
  | 'divine'
  | 'virtue'
  | 'afterlife'
  | 'people'
  | 'practice'
  | 'cosmos'
  | 'terms'
;

export interface GlossaryEntry {
  /** Canonical name, shown in the panel and used as the cache key. */
  term: string;
  /** Forms that actually occur in the translation, plus the usual transliteration. */
  variants: string[];
  translit?: string;
  arabic?: string;
  /** One line, for the inline affordance. */
  short: string;
  /** The fuller note, for the expanded panel. */
  detail?: string;
  category: GlossaryCategory;
  /** Verses the entry draws on, as textId:book:chapter:verse keys. */
  refs?: string[];
  /** True where a variant doubles as an ordinary English word. */
  caseSensitive?: boolean;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: "Allah",
    variants: ["allah"],
    translit: "Allāh",
    arabic: "الله",
    short: "The Arabic word for God; literally 'the One worthy of worship'.",
    detail: "Used throughout the Qur'an as the personal name of the one God. Related names include al-Rahman (the Especially Merciful) and al-Rahim (the Especially Merciful, again).",
    category: 'divine',
    refs: ["quran:1:1:1", "quran:2:1:255"],
  },
  {
    term: "Lord",
    variants: ["lord"],
    translit: "Rabb",
    arabic: "رب",
    short: "One who sustains and governs; the title used for the one God.",
    detail: "From a root meaning 'to be attached to' or 'to care for'. In the Qur'an it conveys both lordship (ownership and authority) and the sustaining care of a master over a servant.",
    category: 'divine',
    refs: ["quran:1:1:2", "quran:2:1:16"],
  },
  {
    term: "Most Merciful",
    variants: ["most merciful", "especially merciful"],
    translit: "al-Raḥmān / al-Raḥīm",
    arabic: "الرحمن الرحيم",
    short: "Two of the ninety-nine names; opening the Qur'an with them.",
    detail: "al-Rahman is the vast, universal mercy; al-Rahim is the specific, particular mercy. The phrase opens every surah except one (At-Tawbah).",
    category: 'divine',
    refs: ["quran:1:1:1", "quran:1:1:3"],
  },
  {
    term: "Grateful",
    variants: ["grateful", "gratitude", "thankful", "ungrateful"],
    translit: "Shākir",
    arabic: "شاكر",
    short: "One who gives thanks; ingratitude is its opposite.",
    detail: "The Qur'an repeatedly links remembrance (dhikr) with gratitude, treating the two as two sides of acknowledging God's favour.",
    category: 'virtue',
    refs: ["quran:2:1:152", "quran:14:1:7"],
  },
  {
    term: "Exalted",
    variants: ["exalted", "majesty", "sublime"],
    translit: "al-ʿAẓīm",
    arabic: "العظيم",
    short: "One of the names of God; also used of the Prophet in 9:40.",
    detail: "Literally 'the magnified'. Paired in the Qur'an with al-Ghafur (the All-Forgiving), as in 'the Exalted, the All-Forgiving'.",
    category: 'divine',
    refs: ["quran:13:1:9", "quran:59:1:23"],
  },
  {
    term: "Sustainer",
    variants: ["sustainer", "provider", "preserver"],
    translit: "al-Razzīq",
    arabic: "الرزاق",
    short: "One who provides for all creation.",
    detail: "The Urdu-speaking tradition often renders this as rizq (provision, sustenance) rather than the name-form.",
    category: 'divine',
    refs: ["quran:51:1:58"],
  },
  {
    term: "Almighty",
    variants: ["almighty", "mighty", "all-mighty", "omnipotent"],
    translit: "al-Qahhār",
    arabic: "القهار",
    short: "One who dominates; the root q-h-r recurs in God's names.",
    detail: "al-Qahhar, 'the Subduer', appears at the close of Surah al-Hajj.",
    category: 'divine',
    refs: ["quran:40:1:16"],
  },
  {
    term: "Forbearing",
    variants: ["forbearing", "forgives", "all-forgiving"],
    translit: "al-Ḥalīm",
    arabic: "الحليم",
    short: "One who bears with His servants and does not punish hastily.",
    detail: "Often paired with al-ʿAzīm in the closing verses of al-Baqarah.",
    category: 'divine',
    refs: ["quran:2:1:263", "quran:42:1:15"],
  },
  {
    term: "Merciful",
    variants: ["merciful", "mercy", "compassionate"],
    translit: "Raḥmān / Raḥīm",
    arabic: "رحمن رحيم",
    short: "Root r-ḥ-m: tenderness, the quality of being moved to help.",
    detail: "Covers both divine mercy and the human mercy (rahma) of mothers, compassion and the mercy of an animal, and even the mercy shown by wild beasts.",
    category: 'divine',
    refs: ["quran:21:1:107", "quran:12:1:83"],
  },
  {
    term: "Prayer",
    variants: ["prayer", "prayed", "prayers", "pray"],
    translit: "Ṣalāh",
    arabic: "صلاة",
    short: "The ritual worship of Islam, performed five times a day.",
    detail: "From a root meaning 'to closely follow, to be in constant connection'. It includes the physical postures, the recitation, and the turning of the heart.",
    category: 'divine',
    refs: ["quran:29:1:45", "quran:4:1:103"],
  },
  {
    term: "Zakat",
    variants: ["alms", "alms-tax", "zakat", "charity-tax", "alms-tax"],
    translit: "Zakāh",
    arabic: "زكاة",
    short: "Obligatory almsgiving on wealth; one of the five pillars.",
    detail: "From a root meaning 'growth' or 'increase' - giving alms that grows the giver's standing. The exact rate depends on the type and age of the wealth.",
    category: 'practice',
    refs: ["quran:2:1:263", "quran:9:1:60"],
  },
  {
    term: "Fasting",
    variants: ["fasting", "fast", "fasted", "sawm"],
    translit: "Ṣawm",
    arabic: "صوم",
    short: "Abstaining from food and drink with the intention of worship.",
    detail: "Its root w-s-m also covers 'confinement' and 'preclusion', as in the fast of Moses. The Qur'an uses the word for both fasting and for the month of Ramadan.",
    category: 'practice',
    refs: ["quran:2:1:183", "quran:19:1:54"],
  },
  {
    term: "Pilgrimage",
    variants: ["pilgrimage", "pilgrim", "hajj"],
    translit: "Ḥajj",
    arabic: "حج",
    short: "The once-a-year journey to Makkah; one of the five pillars.",
    detail: "The root ḥ-j-j suggests 'to intend toward' or 'to head for', and carries the sense of a deliberate journey.",
    category: 'practice',
    refs: ["quran:2:1:196", "quran:22:1:27"],
  },
  {
    term: "Worship",
    variants: ["worship", "worshipped", "worshiper"],
    translit: "ʿIbādah",
    arabic: "عبادة",
    short: "Obedience and submission in ritual; the Qur'an uses it broadly for all devotion.",
    detail: "Used not only for ritual prayer but for any submission to God, including internal and ethical devotion.",
    category: 'divine',
    refs: ["quran:2:1:183", "quran:16:1:36"],
  },
  {
    term: "Supplication",
    variants: ["supplication", "invocation"],
    translit: "Duʿāʾ",
    arabic: "دعاء",
    short: "Asking of God directly; described as the essence of worship.",
    detail: "A prophetic supplication 'O Allah, I ask You for guidance and righteousness' opens an extended section of Surah al-Furqan (25:74).",
    category: 'divine',
    refs: ["quran:25:1:74", "quran:40:1:60"],
  },
  {
    term: "Precedent",
    variants: ["precedent", "sunnah"],
    translit: "Sunnah",
    arabic: "سنة",
    short: "The established practice or precedent; used of the Prophet's own pattern.",
    detail: "In the Qur'anic sense the term covers custom and precedent as a binding model to be followed, whether human or prophetic.",
    category: 'terms',
    refs: ["quran:59:1:12", "quran:43:1:22"],
  },
  {
    term: "Abrogation",
    variants: ["abrogate", "abrogating", "abrogated", "supersedes"],
    translit: "Naskh",
    arabic: "نسخ",
    short: "One rule replacing an earlier one; a technical term of Qur'anic law.",
    detail: "Discussed at 2:106, where a rule that was beneficial is replaced by one more binding, and the whole Book belongs to its Lord.",
    category: 'terms',
    refs: ["quran:2:1:106"],
  },
  {
    term: "Abomination",
    variants: ["abomination", "abominable", "impure"],
    translit: "Najas",
    arabic: "نجاسة",
    short: "Filth or impurity; also used for something ritually unclean.",
    detail: "Its antonym ṭahārah, purity, governs a large part of the legal discussion of Ma'idah.",
    category: 'practice',
    refs: ["quran:2:1:222"],
  },
  {
    term: "Righteous",
    variants: ["righteous", "pious", "godly"],
    translit: "Ṭāqī / Ṣāliḥ",
    arabic: "متق / صالح",
    short: "God-conscious: one who guards against evil.",
    detail: "The Qur'an rarely uses taqwa for ritual observance and mainly for an inner guarding of the heart. Ṣāliḥ, 'sound or wholesome', is the related word used of prophets and of the righteous.",
    category: 'virtue',
    refs: ["quran:2:1:2", "quran:9:1:108", "quran:12:1:55"],
  },
  {
    term: "Purity",
    variants: ["purity", "pure", "clean", "purified"],
    translit: "Ṭahārah",
    arabic: "طهارة",
    short: "Ritual and spiritual cleanliness.",
    detail: "The word opens Surah Taha and is the term for both the state of being clean and the act of purifying. Its opposite is najasah, abomination.",
    category: 'practice',
    refs: ["quran:20:1:14", "quran:56:1:79"],
  },
  {
    term: "Taqwa",
    variants: ["taqwa", "god-consciousness"],
    translit: "Taqwā",
    arabic: "تقوى",
    short: "God-consciousness; guarding the heart against sin.",
    detail: "The transliterated form is not used by most English translations, so this entry is here for reference when reading tafsir or Arabic sources. The Quranic sense is given by 49:11: taqwa is 'that by which falsehood is forbidden to the soul'.",
    category: 'virtue',
    refs: ["quran:49:1:13", "quran:2:1:2"],
  },
  {
    term: "Patience",
    variants: ["patience", "patient", "steadfast"],
    translit: "Ṣabr",
    arabic: "صبر",
    short: "Endurance; steadiness under difficulty.",
    detail: "Taqwa and patience are paired repeatedly. Patience is praised in three forms: patience in obedience, patience away from disobedience, and patience with hardship.",
    category: 'virtue',
    refs: ["quran:2:1:153", "quran:18:1:68"],
  },
  {
    term: "Steadfastness",
    variants: ["steadfastness", "firmness", "steadiness"],
    translit: "Qawwīyyah",
    arabic: "قوة",
    short: "Firmness of purpose; being rooted.",
    detail: "Root q-w-y means 'to be strong, to have weight'. The Qur'an asks God for 'firmness of purpose and resolve'.",
    category: 'virtue',
    refs: ["quran:19:1:4", "quran:11:1:43"],
  },
  {
    term: "Forgiveness",
    variants: ["forgiveness", "forgive", "forgiven", "pardoned", "pardon"],
    translit: "ʿAfw",
    arabic: "عفو",
    short: "Pardoning an offence without punishment.",
    detail: "ʿAfw names the act, while maghfirah names the pardon or forgiveness granted, and it is often paired with māl, 'to leave unpunished'.",
    category: 'virtue',
    refs: ["quran:24:1:22", "quran:42:1:40"],
  },
  {
    term: "Mercy in speech",
    variants: ["good speech", "kind speech", "gracious word"],
    translit: "Kalīmah Ṭayyibah",
    arabic: "كلمة طيبة",
    short: "A good word that sows goodness, as a tree that puts out fruit.",
    detail: "The image is given of a good word as a tree whose roots are firm and whose branches reach the sky (14:24).",
    category: 'virtue',
    refs: ["quran:14:1:24", "quran:16:1:97"],
  },
  {
    term: "Humility",
    variants: ["humble", "humility", "modest"],
    translit: "Khushuʿ",
    arabic: "خشوع",
    short: "Inward stillness and attentiveness in worship.",
    detail: "khushuʿ is linked to the heart and to the eyes lowered during prayer - the opposite of distractedness (ghaflah).",
    category: 'virtue',
    refs: ["quran:2:1:222", "quran:23:1:2"],
  },
  {
    term: "Truthfulness",
    variants: ["truthful", "truthfulness", "honest", "honesty"],
    translit: "Ṣidq",
    arabic: "صدق",
    short: "Root ṣ-d-q: to be true, to be aligned with reality.",
    detail: "Truthfulness is presented as inherently paired with faithfulness - 'be true to God even against yourselves'.",
    category: 'virtue',
    refs: ["quran:4:1:69", "quran:17:1:33"],
  },
  {
    term: "Trustworthiness",
    variants: ["trustworthy", "trustworthiness", "entrusted", "entrusts", "render trusts"],
    translit: "Amānah",
    arabic: "أمانة",
    short: "Faithfulness; something entrusted, to be returned intact.",
    detail: "From the root a-m-n, 'to be safe, secure, trustworthy', which also gives amin, 'peace', and iman, 'faith'. The covenant entrusted to the heavens and the earth is an amanah (33:7). Note: the ordinary English word 'trust' on its own is not the Qur'anic term and is not highlighted.",
    category: 'virtue',
    refs: ["quran:4:1:58", "quran:33:1:7", "quran:33:1:72"],
  },
  {
    term: "Injustice",
    variants: ["injustice", "unjust", "oppress", "oppressed", "wrongdoer", "wronged", "transgress"],
    translit: "Ẓulm",
    arabic: "ظلم",
    short: "Root ḍ-l-m: to put something in the wrong place, to exceed bounds.",
    detail: "Used for placing a thing where it does not belong, in the body, in the world, or in a relationship - and so for wronging people, or even a soul wronging itself.",
    category: 'virtue',
    refs: ["quran:2:1:217", "quran:4:1:22"],
  },
  {
    term: "Remembrance",
    variants: ["remembrance", "remember", "remembers", "reminded"],
    translit: "Dhikr",
    arabic: "ذكر",
    short: "Mentioning God by any means: with the tongue, in thought, or in action.",
    detail: "Root dh-k-r, from 'a horse with no rider', which is quiet until its rider returns; the Qur'an uses the word for remembering and for the Qur'an itself.",
    category: 'divine',
    refs: ["quran:2:1:152", "quran:73:1:8"],
  },
  {
    term: "Repentance",
    variants: ["repentance", "repent", "repented"],
    translit: "Tawbah",
    arabic: "توبة",
    short: "Turning back to God in regret and resolve.",
    detail: "Root t-w-b means 'to turn'. The Qur'an adds a condition: turning back before the soul reaches the throat, or before the sun rises from its west.",
    category: 'virtue',
    refs: ["quran:9:1:104", "quran:4:1:18"],
  },
  {
    term: "Sin",
    variants: ["sin", "sins", "transgression", "transgressions"],
    translit: "Ithm",
    arabic: "إثم",
    short: "Root '-th-m: to bring harm or loss upon oneself.",
    detail: "The Qur'an lists major sins - shirk, murder, fornication, false accusation of the chaste, theft - and weighs lesser deeds by their intention.",
    category: 'terms',
    refs: ["quran:6:1:151", "quran:17:1:31"],
  },
  {
    term: "Major sin",
    variants: ["major sins", "greater sins"],
    translit: "Ithm Kabīr",
    arabic: "إثم كبير",
    short: "The gravest offences, which the Qur'an names explicitly.",
    detail: "'If you avoid the major sins which you are forbidden, We will remove from you your misdeeds' (39:53). The list is given at 6:151 and 17:31-33.",
    category: 'terms',
    refs: ["quran:39:1:53", "quran:6:1:151"],
  },
  {
    term: "Unlawful sexual intercourse",
    variants: ["adultery", "unlawful sexual intercourse", "fornication", "adulterer", "adulteress"],
    translit: "Zinā",
    arabic: "زنا",
    short: "Illicit sexual intercourse; the term also covers the false accusation of it.",
    detail: "Root z-y-n, meaning both 'to commit fornication' and 'to accuse falsely' - so accusing a chaste person of zina is itself zina. Named explicitly among the major sins (17:21).",
    category: 'practice',
    refs: ["quran:17:1:21", "quran:4:1:15"],
  },
  {
    term: "Hereafter",
    variants: ["hereafter", "afterlife", "the hereafter"],
    translit: "Ākhirah",
    arabic: "آخرة",
    short: "The next world, in contrast with this world (dunya).",
    detail: "Root '-kh-r means 'the other, the later one'. The contrast dunya and akhirah runs through the whole Qur'an.",
    category: 'afterlife',
    refs: ["quran:2:1:212", "quran:2:1:4"],
  },
  {
    term: "Worldly",
    variants: ["worldly", "dunya", "life of this world"],
    translit: "Dunyā",
    arabic: "دنيا",
    short: "This present life; the Qur'an never condemns it, only its excess.",
    detail: "'Enjoyment of the world' - the point is not that the world is forbidden but that it is transient and meant to be a passage.",
    category: 'afterlife',
    refs: ["quran:21:1:35", "quran:57:1:20"],
  },
  {
    term: "Paradise",
    variants: ["paradise", "gardens", "garden", "gardens of"],
    translit: "Jannah",
    arabic: "جنّة",
    short: "Root j-n-n: to be hidden or covered; the garden of the Hereafter.",
    detail: "The root's sense of covering fits the Qur'anic description of Paradise as hidden from human sight.",
    category: 'afterlife',
    refs: ["quran:2:1:35", "quran:76:1:12"],
  },
  {
    term: "Hellfire",
    variants: ["hellfire", "hell", "blazing fire", "the fire"],
    translit: "Jahannam",
    arabic: "جهنم",
    short: "The fire of the Hereafter; an Arabic formation meaning 'the veiled thing'.",
    detail: "The root j-h-n-m suggests 'a veil of smoke'. It is called the Fire that glows and the Fire that climbs.",
    category: 'afterlife',
    refs: ["quran:82:1:15", "quran:55:1:55"],
  },
  {
    term: "Reward",
    variants: ["reward", "recompense", "rewards"],
    translit: "Ajr",
    arabic: "أجر",
    short: "Root '-j-r: to return, to bring back.",
    detail: "Because the root implies 'a return', the Qur'an connects reward with resurrection: the return is itself the payment.",
    category: 'afterlife',
    refs: ["quran:3:1:195", "quran:34:1:22"],
  },
  {
    term: "Good deeds",
    variants: ["good deeds", "righteous deeds", "deeds", "good deed"],
    translit: "Ḥasanāt",
    arabic: "حسنات",
    short: "Root ḥ-s-n: to be beautiful or good in quality.",
    detail: "The word ḥasanat is used for a woman's good deeds as well as for a good deed in the plural, and for the beautiful in both senses.",
    category: 'afterlife',
    refs: ["quran:4:1:4", "quran:2:1:110"],
  },
  {
    term: "Resurrection",
    variants: ["resurrection", "resurrect", "resurrected", "raised from the dead"],
    translit: "Qiyāmah",
    arabic: "قيامة",
    short: "The Day of Standing, when the dead are raised.",
    detail: "From q-y-m, 'to stand'. The Qur'an uses it for the Day itself and for the rising of the soul. Note the bare English word 'raised' is deliberately not highlighted, since it is too common to be a reliable marker.",
    category: 'afterlife',
    refs: ["quran:2:1:85", "quran:75:1:40"],
  },
  {
    term: "The Hour",
    variants: ["hour", "last day", "day of judgment", "day of judgement", "day of reckoning"],
    translit: "Sāʿah",
    arabic: "ساعة",
    short: "The Hour; the decisive moment of judgement.",
    detail: "Also called the qiyamah; both terms appear in the same breath in verses such as 4:1 and 6:60. Sa'ah is also an ordinary unit of time, so only eschatological senses are highlighted here.",
    category: 'afterlife',
    refs: ["quran:4:1:1", "quran:6:1:60"],
  },
  {
    term: "Judgement",
    variants: ["judgement", "judgment", "reckoning", "account"],
    translit: "Qist",
    arabic: "قسط",
    short: "Root q-s-t: to measure, to weigh, to divide justly.",
    detail: "The weighing on judgement day - the scale placed to be weighed on, where the deeds themselves speak (21:101).",
    category: 'afterlife',
    refs: ["quran:21:1:101", "quran:3:1:18"],
  },
  {
    term: "Scale",
    variants: ["scale", "scales", "balance", "balanced"],
    translit: "Mīzān",
    arabic: "ميزان",
    short: "A balance; also metaphor for justice and for the Qur'an itself.",
    detail: "God and His messengers set up the balance - taken twice in the same verse (55:7-9) to make the point that justice is a joint responsibility.",
    category: 'terms',
    refs: ["quran:55:1:7", "quran:17:1:18"],
  },
  {
    term: "Wrongdoers",
    variants: ["wrongdoers", "transgressors", "sinners", "sinful"],
    translit: "Ẓālimūn",
    arabic: "ظالمون",
    short: "The plural of zulm: those who transgress and wrong.",
    detail: "Part of the Qur'an's running contrast between the believers and the wrongdoers.",
    category: 'terms',
    refs: ["quran:2:1:58", "quran:3:1:112"],
  },
  {
    term: "Intercession",
    variants: ["intercession", "intercede", "intercessor"],
    translit: "Shafāʿah",
    arabic: "شفاعة",
    short: "Root sh-f-w, 'to ask together, to intercede for'. The word also means shyness or coyness.",
    detail: "The Qur'an teaches that no intercession happens except by God's permission, and that He may withhold it (74:48).",
    category: 'afterlife',
    refs: ["quran:74:1:48", "quran:5:1:35"],
  },
  {
    term: "Fuel",
    variants: ["fuel", "wood for the fire"],
    translit: "Wazīʿ",
    arabic: "وقود",
    short: "Fuel: both firewood for the fire and fuel for metaphor.",
    detail: "'Fuel for the fire' is applied both to wood and to people - disbelievers described as fuel (70:15-16).",
    category: 'afterlife',
    refs: ["quran:70:1:16", "quran:11:1:3"],
  },
  {
    term: "Evil",
    variants: ["evil", "evils", "evil deed", "evil deeds", "evil-doing"],
    translit: "Shar",
    arabic: "شر",
    short: "Root sh-r-r: to flow, to spread. Used for both moral evil and physical harm.",
    detail: "Used of a scorpion's sting as well as of wrongdoing - the Qur'an uses the same word for harm and for moral evil. Its counterpart is hasan, goodness.",
    category: 'terms',
    refs: ["quran:55:1:59", "quran:4:1:49"],
  },
  {
    term: "Messenger",
    variants: ["messenger", "messengers"],
    translit: "Rasūl",
    arabic: "رسول",
    short: "One sent with a message; the title of the Prophet Muhammad.",
    detail: "Root r-s-l means 'to send'. Also used for angels and for Messengers such as Jesus, Moses, and Noah.",
    category: 'people',
    refs: ["quran:33:1:40", "quran:2:1:87"],
  },
  {
    term: "Prophet",
    variants: ["prophet", "prophets"],
    translit: "Nabī",
    arabic: "نبي",
    short: "From n-b-a: to announce, to give news. A prophet receives revelation and conveys it.",
    detail: "The root points to 'coming', suggesting 'he was sent'. The word 'weeping' in the term 'weeping prophet' (25:8) is debated among scholars.",
    category: 'people',
    refs: ["quran:4:1:163", "quran:25:1:7"],
  },
  {
    term: "Believer",
    variants: ["believer", "believers", "believed", "believe", "believing"],
    translit: "Mu'min",
    arabic: "مؤمن",
    short: "One who has faith; from amn, security and peace.",
    detail: "The root is also the source of 'peace' (salam) and safety, and the Qur'an links belief with peace in 4:131.",
    category: 'people',
    refs: ["quran:2:1:2", "quran:4:1:131"],
  },
  {
    term: "Disbeliever",
    variants: ["disbeliever", "disbelievers", "disbelief", "disbelieved", "denied", "unbeliever"],
    translit: "Kāfir",
    arabic: "كافر",
    short: "One who denies; from k-f-r, to cover or deny.",
    detail: "'To cover' is the root sense - the denial that 'covers' the truth. It is a word for rejecting God, not for doubting about trivia.",
    category: 'people',
    refs: ["quran:2:1:108", "quran:40:1:70"],
  },
  {
    term: "Hypocrite",
    variants: ["hypocrite", "hypocrites", "hypocrisy"],
    translit: "Munāfiq",
    arabic: "منافق",
    short: "One who professes faith outwardly while working against it inwardly.",
    detail: "From n-f-q, meaning 'to exit, to diverge'. Used especially of the Prophet's companions who outwardly confirmed and inwardly conspired.",
    category: 'people',
    refs: ["quran:9:1:54", "quran:9:1:101"],
  },
  {
    term: "Servant",
    variants: ["servant", "servants"],
    translit: "ʿAbd",
    arabic: "عبد",
    short: "One who is bound and subject; a servant of God.",
    detail: "'Abd Allah is often rendered 'servant of God'. The term also became a proper name for the third caliph, Uthman.",
    category: 'people',
    refs: ["quran:2:1:26", "quran:16:1:1"],
  },
  {
    term: "Witness",
    variants: ["witness", "witnesses", "witnessed", "testimony"],
    translit: "Shāhid",
    arabic: "شهيد",
    short: "Root sh-h-d: to testify, to bear witness. Also a martyr.",
    detail: "The root gives both 'witness' and 'martyr', which is how the word came to mean one who dies for the faith.",
    category: 'people',
    refs: ["quran:2:1:143", "quran:3:1:18"],
  },
  {
    term: "Enmity",
    variants: ["enmity", "enemies", "enemy", "hatred", "hostility"],
    translit: "'Adāwah",
    arabic: "عداوة",
    short: "Root '-d-w: to cross, to oppose. Enmity is a crossing over against.",
    detail: "The Qur'an speaks of placing an enmity between the tribes of the believers and the disbelievers, and between the people of the book (3:69).",
    category: 'terms',
    refs: ["quran:3:1:69", "quran:18:1:34"],
  },
  {
    term: "Command",
    variants: ["command", "commands", "commanded", "ordered"],
    translit: "Amr",
    arabic: "أمر",
    short: "Root '-m-r: to order, to command, to make matter of.",
    detail: "Often paired with nahy, prohibition - 'commanded what is good and forbidden what is evil' (2:134).",
    category: 'terms',
    refs: ["quran:2:1:134", "quran:7:1:157"],
  },
  {
    term: "Knowledge",
    variants: ["knowledge"],
    translit: "ʿIlm",
    arabic: "علم",
    short: "Root '-l-m: to know with certainty, to mark, to distinguish.",
    detail: "The Quranic story of the servants of the Two Gardens, who were given knowledge 'and used it to choose themselves over their own souls' (20:122), frames knowledge as moral agency.",
    category: 'terms',
    refs: ["quran:20:1:122", "quran:58:1:11"],
  },
  {
    term: "Wisdom",
    variants: ["wisdom", "wise"],
    translit: "Ḥikmah",
    arabic: "حكمة",
    short: "Root ḥ-k-m: to prevent, to bind. Wisdom is sound judgment that restrains from excess.",
    detail: "The Qur'an says wisdom was given to Luqman the Wise, and to Muhammad (31:12).",
    category: 'terms',
    refs: ["quran:31:1:12", "quran:17:1:23"],
  },
  {
    term: "Guidance",
    variants: ["guidance", "guided", "guide", "guides", "misguided"],
    translit: "Hidāyah",
    arabic: "هداية",
    short: "Root h-d-y: to point the way, to lead straight.",
    detail: "Guidance is both God's gift ('We do not guide anyone but by Our will') and a human path that is trodden (2:213).",
    category: 'terms',
    refs: ["quran:2:1:213", "quran:20:1:82"],
  },
  {
    term: "Precipice",
    variants: ["precipice", "abyss", "bottomless"],
    translit: "Ghāwiyah",
    arabic: "غاوية",
    short: "Root gh-w-y: to mislead into error, or the pit into which one falls.",
    detail: "'A traveller who loses his way from the path and reaches a barren land' (al-Hajj 22:53) shows the sense of both misguidance and the place it ends in.",
    category: 'afterlife',
    refs: ["quran:22:1:53"],
  },
  {
    term: "Reminder",
    variants: ["reminder", "reminders", "admonition", "exhortation"],
    translit: "Dhikrā",
    arabic: "ذكرى",
    short: "Something that recalls; the Qur'an as reminder, and those who remind.",
    detail: "From 'to remind' or 'to call to mind' - 'O my people, I am but a clear reminder to you' (26:105).",
    category: 'people',
    refs: ["quran:26:1:105", "quran:44:1:23"],
  },
  {
    term: "Atonement",
    variants: ["ransom", "expiation", "atonement"],
    translit: "Kaffārah",
    arabic: "كفارة",
    short: "Root k-f-r: to cover, to atone for. An act that covers an offence.",
    detail: "The root is the same as that of kufr, 'disbelief' - covering a fault with an act that covers it.",
    category: 'practice',
    refs: ["quran:2:1:178", "quran:2:1:196"],
  },
  {
    term: "Blood",
    variants: ["blood", "bloods", "spilt"],
    translit: "Damm",
    arabic: "دم",
    short: "A soul's blood, held sacred and not to be spilled unjustly.",
    detail: "Root d-m-m means 'to flow'. The Qur'an treats a soul as a vessel for blood at 5:6.",
    category: 'practice',
    refs: ["quran:5:1:6", "quran:4:1:29"],
  },
  {
    term: "Provision",
    variants: ["provision", "sustenance", "sustenance of"],
    translit: "Rizq",
    arabic: "رزق",
    short: "Root r-z-q: to cause to flow, to feed. Sustenance for body and soul.",
    detail: "'Provision from your Lord' refers both to daily bread and, in the Qur'an's wider sense, to guidance.",
    category: 'practice',
    refs: ["quran:51:1:58", "quran:2:1:168"],
  },
  {
    term: "Favour",
    variants: ["favour", "favours", "blessing", "blessings", "bounty"],
    translit: "Niʿmah",
    arabic: "نعمة",
    short: "Root n-'-m: to give generously, to benefit. Grace given without being earned.",
    detail: "The Qur'an frequently couples ni'mah with dhikr - remembering the favour is itself a form of worship.",
    category: 'terms',
    refs: ["quran:16:1:18", "quran:27:1:40"],
  },
  {
    term: "Covenant",
    variants: ["covenant", "covenants", "pact", "pacts", "pledge", "testament"],
    translit: "Mithāq / ʿAhd",
    arabic: "ميثاق / عهد",
    short: "Root m-th-q and '-h-d: to promise, to bind. A solemn, binding pact.",
    detail: "Used for the covenants given to the heavens and the earth (33:7), to the prophets, and to the Children of Israel. 'Ahd Allah is the pledge of allegiance taken at Aqabah (48:10).",
    category: 'terms',
    refs: ["quran:33:1:7", "quran:48:1:10", "quran:49:1:14"],
  },
  {
    term: "Lot and share",
    variants: ["lottery", "stake"],
    translit: "Qismah",
    arabic: "قسمه",
    short: "Root q-s-m: to divide into parts. A share divided by lot.",
    detail: "Used for the division of the spoils at Badr, and in the Qur'anic phrase 'lot of the Hereafter' (3:180). Neither the bare word 'lot' nor 'lot of' is matched, because both fire on ordinary English ('a lot of noise'). Only 'lottery' and 'stake' are, so this entry is reference-only in the English translation.",
    category: 'terms',
    refs: ["quran:3:1:180", "quran:5:1:6"],
  },
  {
    term: "Usury",
    variants: ["usury", "usurious", "interest"],
    translit: "Ribā",
    arabic: "ربا",
    short: "Root r-b-w: to exceed, to grow. Any unjust increase over what is lent.",
    detail: "Prohibited in the Qur'an and repeated in 2:276-279, with the metaphor that 'God has abolished interest and granted increase to the believers'.",
    category: 'practice',
    refs: ["quran:2:1:276", "quran:2:1:279"],
  },
  {
    term: "Veil",
    variants: ["veil", "veiled", "covered", "covering"],
    translit: "Hijāb",
    arabic: "حجاب",
    short: "A screen or curtain; what lies between the eyes and the truth.",
    detail: "'Veiled' is the Qur'an's word for disbelievers' hearts, and for modesty before God.",
    category: 'terms',
    refs: ["quran:2:1:7", "quran:45:1:16"],
  },
  {
    term: "Light (Nur)",
    variants: ["light upon light", "the light of the heavens", "nur"],
    translit: "Nūr",
    arabic: "نور",
    short: "Root n-w-r: to shine. God described as the Light of the heavens and the earth.",
    detail: "'Allah is the Light of the heavens and the earth. The parable of His light is as a niche wherein is a lamp; the lamp is in glass' (24:35) - the famous Verse of Light. Only these specific phrases are highlighted; the ordinary English word 'light' is left alone.",
    category: 'divine',
    refs: ["quran:24:1:35", "quran:35:1:21"],
  },
  {
    term: "Whisper",
    variants: ["whisper", "whispered", "whispers", "whispering"],
    translit: "Waswāṣ",
    arabic: "وسواس",
    short: "Root s-w-s: to whisper, to hint. The whisper of Satan to the human soul.",
    detail: "Qur'anic surah al-Nas names it 'the whisperer when man is heedless' (114:4-6).",
    category: 'terms',
    refs: ["quran:114:1:4", "quran:7:1:5"],
  },
  {
    term: "Satan",
    variants: ["satan", "devil", "shaytan", "satans"],
    translit: "Shaytān",
    arabic: "شيطان",
    short: "Root sh-y-t-n: to be distant, remote, to be away; the one who is far from truth.",
    detail: "Also rendered 'devil'. The plural 'shayatin' refers to the army of satans that supported the disbelievers at Badr.",
    category: 'people',
    refs: ["quran:7:1:5", "quran:2:1:102"],
  },
  {
    term: "Envy",
    variants: ["envious", "envy", "jealous", "grudge"],
    translit: "Ḥasūd",
    arabic: "حسود",
    short: "Root ḥ-s-d: to covet, to wish for what another has.",
    detail: "The Qur'an speaks of those who 'eat the wealth of orphans wrongfully, and when they come to you they say we were only doing our job' (4:10).",
    category: 'virtue',
    refs: ["quran:4:1:10", "quran:35:1:21"],
  },
  {
    term: "Evil eye",
    variants: ["evil eye", "envy of the eye", "eye of envy"],
    translit: "ʿĀyina",
    arabic: "عين",
    short: "Root '-y-n: the eye, and by extension envy or harm believed to come through the eye.",
    detail: "Often rendered 'the evil eye'. Believed and mentioned in the traditions, and permitted only by God.",
    category: 'terms',
    refs: ["quran:35:1:21", "quran:3:1:12"],
  },
  {
    term: "Creation",
    variants: ["creation", "created", "creates"],
    translit: "Khalq",
    arabic: "خلق",
    short: "Root kh-l-q: to measure, to weigh, to create anew.",
    detail: "Because the root means 'to measure and proportion', Qur'anic creation is described as 'measured' (13:16).",
    category: 'cosmos',
    refs: ["quran:13:1:16", "quran:59:1:24"],
  },
  {
    term: "Soul",
    variants: ["soul", "souls", "spirit", "spirits", "nafs"],
    translit: "Nafs / Rūḥ",
    arabic: "نفس / روح",
    short: "The self; the human spirit.",
    detail: "nafs runs from 'to breathe' to 'ego'; ruh from 'breath, breeze, relief'. The Qur'an speaks of the soul's commands (12:98).",
    category: 'people',
    refs: ["quran:12:1:98", "quran:4:1:1"],
  },
  {
    term: "Angel",
    variants: ["angel", "angels"],
    translit: "Malak",
    arabic: "ملك",
    short: "Root m-l-k: to possess, to own, to command. A created being sent to do God's will.",
    detail: "Angels are not described as a separate species but as created servants given wings (2:124).",
    category: 'people',
    refs: ["quran:2:1:124", "quran:35:1:1"],
  },
  {
    term: "Jinn",
    variants: ["jinn", "jinns"],
    translit: "Jinn",
    arabic: "جن",
    short: "Root j-n-n: to be hidden or veiled; a creation made of smokeless fire.",
    detail: "Neither wholly human nor angel, and not all jinn are evil. The Qur'an states their twofold division (6:76).",
    category: 'people',
    refs: ["quran:6:1:76", "quran:72:1:1"],
  },
  {
    term: "Guardian",
    variants: ["guardian", "guardians", "guardian angels", "guardian angel"],
    translit: "Ḥafīz",
    arabic: "حفيظ",
    short: "Root ḥ-f-z: to guard, to preserve. A keeper appointed over each person.",
    detail: "'Each of you is a guardian over what is sent before him and what is sent after him' (43:8).",
    category: 'people',
    refs: ["quran:43:1:8", "quran:11:1:39"],
  },
  {
    term: "Decree and measure",
    variants: ["destiny", "decree", "decreed", "ordained", "predestined", "preordained"],
    translit: "Qadar",
    arabic: "قدر",
    short: "Root q-d-r: to measure, to determine. Measure and appointed share a word.",
    detail: "The same root gives qadar, 'measure', and qadr, 'decree', so divine decree and measure are linked by wordplay throughout the Qur'an. 13:11: 'Allah does not change a people until they change what is in themselves'. Note the English word 'will' as in 'the will of God' is not highlighted, since it is too ordinary to be a reliable marker.",
    category: 'terms',
    refs: ["quran:13:1:11", "quran:54:1:49", "quran:6:1:38"],
  },
  {
    term: "Abode",
    variants: ["abode", "abiding place", "resting place", "final home"],
    translit: "Maqām",
    arabic: "مقام",
    short: "Root q-w-m: to stand, to stay. A place of standing.",
    detail: "'You will reside in the abiding place of the Hereafter' (43:70) - maqam is used both of the standing place and of the residence.",
    category: 'afterlife',
    refs: ["quran:43:1:70", "quran:37:1:144"],
  },
  {
    term: "Adversity",
    variants: ["adversity", "calamity", "affliction", "hardship"],
    translit: "Bala",
    arabic: "بلاء",
    short: "Root b-l-w: to test, to try. A trial sent to test or to purify.",
    detail: "The same root gives 'to test' and 'to make clear' - the trial both tries and reveals.",
    category: 'terms',
    refs: ["quran:2:1:155", "quran:94:1:5"],
  },
  {
    term: "Trial",
    variants: ["trial", "trials", "trials", "test"],
    translit: "Fitnah",
    arabic: "فتنة",
    short: "Root f-t-n: to try with fire, to test. A testing, and hence also a fitna - a trial, an offence, or a dissension.",
    detail: "The root's fire-image is taken from metal-working: the tempering of a blade. The word carries both 'trial' and 'strife'.",
    category: 'terms',
    refs: ["quran:8:1:41", "quran:2:1:102"],
  },
  {
    term: "Strife",
    variants: ["strife", "corruption", "corrupt", "mischief"],
    translit: "Fasād",
    arabic: "فساد",
    short: "Root f-s-d: to exceed, to spread corruption. Disorder in place of right.",
    detail: "The Qur'an describes Qur'an itself as 'a word of parting' (fsad) and 'the best speech' - the same root.",
    category: 'terms',
    refs: ["quran:2:1:108", "quran:7:1:188"],
  },
  {
    term: "Chastity",
    variants: ["chastity", "chaste"],
    translit: "'Iffah",
    arabic: "عفة",
    short: "Root '-f-f: to turn away from, to shun. Modesty and restraint.",
    detail: "'Iffah covers sexual restraint and the guarding of the self more broadly, and is the quality praised in the wife of a Pharaoh.",
    category: 'virtue',
    refs: ["quran:4:1:24", "quran:66:1:3"],
  },
  {
    term: "Sacrifice",
    variants: ["sacrifice", "sacrifices", "slaughter", "sacrificial"],
    translit: "Ḍaḥīyah",
    arabic: "ذبيحة",
    short: "Root d-b-h: to slaughter, to sacrifice. A slaughtered animal.",
    detail: "Used both for ritual slaughter and, metaphorically, for the sacrifice of the son of Ibrahim (37:107).",
    category: 'practice',
    refs: ["quran:37:1:107", "quran:22:1:34"],
  },
  {
    term: "Sign",
    variants: ["sign", "signs", "portent"],
    translit: "Āyāt",
    arabic: "آيات",
    short: "Root '-y-y: to pass, to come, to signify. Signs and verses alike.",
    detail: "'Aya' means both a verse of the Qur'an and a sign of God - the word carries 'proof' inside it.",
    category: 'terms',
    refs: ["quran:2:1:164", "quran:21:1:30"],
  },
  {
    term: "Miracle",
    variants: ["miracle", "miracles"],
    translit: "Mū'jizah",
    arabic: "معجزة",
    short: "Root '-j-z: to hinder, to make impossible. An event that suspends the usual order.",
    detail: "The root is the same as that of 'injury' (mūjiz) - a miracle 'disables' the ordinary course of things.",
    category: 'terms',
    refs: ["quran:2:1:252", "quran:26:1:33"],
  },
  {
    term: "Orphanhood",
    variants: ["orphan", "orphans", "orphanage"],
    translit: "Yatīm / Yatāmah",
    arabic: "يتيم / يتمة",
    short: "Having no father, or no parents; the state of the yatim.",
    detail: "Root y-t-m means 'to be bereft, to have no one'. Treating orphans well is praised more often than any other single virtue in the Qur'an, and Surah al-Duha opens by asking about the orphan (93:6).",
    category: 'people',
    refs: ["quran:93:1:6", "quran:4:1:2"],
  },
  {
    term: "Homestead",
    variants: ["homestead", "home", "sanctuary"],
    translit: "Bayt",
    arabic: "بيت",
    short: "Root b-y-t: to dwell. A house; also used of the Ka'ba, 'the House'.",
    detail: "bayt is both the house of a man and the House of God, and the word is used of the Ka'ba at 2:125.",
    category: 'terms',
    refs: ["quran:2:1:125", "quran:2:1:127"],
  },
  {
    term: "Kaaba",
    variants: ["kaaba", "ka'ba", "sacred mosque", "sacred house"],
    translit: "Kaʿbah",
    arabic: "كعبة",
    short: "The cube-shaped sanctuary at the centre of Islam in Makkah.",
    detail: "'The first House established for mankind was the one at Bakkah' (3:96) - ka'ba means a square, cube-shaped building.",
    category: 'practice',
    refs: ["quran:3:1:96", "quran:2:1:125"],
  },
  {
    term: "Blasphemy",
    variants: ["blasphemy", "blasphemer", "insulted", "slander"],
    translit: "Kufru",
    arabic: "كفر",
    short: "Root k-f-r: to cover, to deny. Denial of God.",
    detail: "'Those who took a deity besides Me, then they were brought down upon their own selves' - kufr covers both denial and ingratitude.",
    category: 'terms',
    refs: ["quran:4:1:108", "quran:2:1:108"],
  },
  {
    term: "Abraham",
    variants: ["abraham", "ibrahim"],
    translit: "Ibrāhīm",
    arabic: "إبراهيم",
    short: "The patriarch, ancestor of prophets and a friend of God.",
    detail: "Given 'sound judgment' (hikmah) and the title 'father of Arabs'. His prayer is the famous cry of the ancestors: 'Our Lord, accept this from us' (2:127-129).",
    category: 'people',
    refs: ["quran:2:1:127", "quran:21:1:69"],
  },
  {
    term: "Moses",
    variants: ["moses", "harun"],
    translit: "Mūsā",
    arabic: "موسى",
    short: "The prophet who spoke directly to Allah and led his people from Pharaoh.",
    detail: "Called Kalim Allah, 'he who spoke with God'. His story runs from the burning bush to the divided sea.",
    category: 'people',
    refs: ["quran:20:1:8", "quran:28:1:7"],
  },
  {
    term: "Noah",
    variants: ["noah", "nuh"],
    translit: "Nūḥ",
    arabic: "نوح",
    short: "The prophet of the ark and the first messenger.",
    detail: "Called 'the truthful' (2:143 - 'Nuh among the truthful'). He is named in surahs 7, 11, 23, 26, 29, 50, 54, 71.",
    category: 'people',
    refs: ["quran:71:1:1", "quran:7:1:59"],
  },
  {
    term: "David",
    variants: ["david", "dawud"],
    translit: "Dāwūd",
    arabic: "داود",
    short: "The prophet and king to whom the Zabur (Psalms) was given.",
    detail: "'And to David We gave wisdom and the Zabur' (4:163) - the only prophet named as receiving a scripture in that verse.",
    category: 'people',
    refs: ["quran:4:1:163", "quran:34:1:11"],
  },
  {
    term: "Solomon",
    variants: ["solomon", "sulayman"],
    translit: "Sulaymān",
    arabic: "سليمان",
    short: "The prophet-king to whom the Book of Psalms and dominion were given.",
    detail: "'And to Solomon We gave judgment and sound understanding' (38:20). He is praised for the wind, the jinn, and the ants.",
    category: 'people',
    refs: ["quran:38:1:20", "quran:27:1:30"],
  },
  {
    term: "Job",
    variants: ["job", "ayyub"],
    translit: "Ayyūb",
    arabic: "أيوب",
    short: "The prophet whose long affliction was turned to ease by his endurance.",
    detail: "'And remember Ayyub when he cried to his Lord: I have been harmed and You are the Most Merciful' (21:83).",
    category: 'people',
    refs: ["quran:21:1:83", "quran:38:1:41"],
  },
  {
    term: "Jesus",
    variants: ["jesus", "isa", "jesus son of maryam"],
    translit: "ʿĪsā",
    arabic: "عيسى",
    short: "The prophet, servant and messenger of Mary, called the Word and a Spirit from Him.",
    detail: "'The Word and a Spirit from Him' (4:171). Qur'anic accounts of him centre on the virgin birth and the crucifixion - which the Qur'an does not affirm as death.",
    category: 'people',
    refs: ["quran:4:1:171", "quran:5:1:75"],
  },
  {
    term: "Joseph",
    variants: ["joseph", "yusuf"],
    translit: "Yūsuf",
    arabic: "يوسف",
    short: "The prophet whose story of patience and interpreting dreams fills Surah Yusuf.",
    detail: "'The most truthful of dream interpreters' (12:36). The surah is named for him.",
    category: 'people',
    refs: ["quran:12:1:36", "quran:12:1:108"],
  },
  {
    term: "Jacob",
    variants: ["jacob", "yakuub"],
    translit: "Yaʿqūb",
    arabic: "يعقوب",
    short: "The prophet-father of Joseph, Israel, and his twelve sons.",
    detail: "'A man of firm resolve and clear sight' (12:68). Twelve tribes descend from his twelve sons.",
    category: 'people',
    refs: ["quran:12:1:68", "quran:2:1:136"],
  },
  {
    term: "Lot",
    variants: ["Lot", "Lut"],
    translit: "Lūṭ",
    arabic: "لوط",
    short: "The prophet sent to the people of Sodom.",
    detail: "He is praised for rescuing his family and for saying 'I seek refuge in the Mighty One' (26:169). Matched case-sensitively, since 'Lot' is also an ordinary English word and only the capitalised name here is the prophet.",
    category: 'people',
    refs: ["quran:26:1:169", "quran:7:1:179"],
    caseSensitive: true,
  },
  {
    term: "Joshua",
    variants: ["joshua", "yusha"],
    translit: "Yūshāʾ",
    arabic: "يوشع",
    short: "The prophet after Moses, who brought the Children of Israel into the land.",
    detail: "In the Qur'an he is named together with Caleb (al-Ma'sada, 5:22).",
    category: 'people',
    refs: ["quran:5:1:22", "quran:5:1:24"],
  },
  {
    term: "Moses's people",
    variants: ["children of israel", "bani israil", "israel"],
    translit: "Banī Isrāʾīl",
    arabic: "بني إسرائيل",
    short: "Descendants of Jacob, given scripture and favoured as a chosen people.",
    detail: "Their story with the covenant, the golden calf, and the exile is a running theme in the Qur'an.",
    category: 'people',
    refs: ["quran:2:1:121", "quran:5:1:77"],
  },
  {
    term: "Mary",
    variants: ["maryam", "mary", "imran"],
    translit: "Maryam",
    arabic: "مريم",
    short: "The mother of Jesus, praised for her chastity and her mother of the Book.",
    detail: "'Mary, the mother of Jesus, said: The Lord has chosen you over the people of the world and purified you' (3:44).",
    category: 'people',
    refs: ["quran:3:1:44", "quran:5:1:75"],
  },
  {
    term: "Anne",
    variants: ["anne", "hannah", "anne moses"],
    translit: "Ānnā",
    arabic: "آمنة",
    short: "The mother of Mary, who dedicated her unborn child to the Lord.",
    detail: "'My Lord, I have vowed to the One in the womb what is in my right hand, so accept from me' (3:35) - Anne's vow of Mary. The English translation does not name her, so this entry is for reference when reading tafsir.",
    category: 'people',
    refs: ["quran:3:1:35", "quran:3:1:29"],
  },
  {
    term: "Pharaoh",
    variants: ["pharaoh", "fir'awn"],
    translit: "Firʿawn",
    arabic: "فرعون",
    short: "The tyrant of Egypt who opposed Moses and claimed divinity.",
    detail: "'Fir'awn said: I am your lord, most high' (28:23). His name is also the name of the Nile.",
    category: 'people',
    refs: ["quran:28:1:23", "quran:44:1:17"],
  },
  {
    term: "Torah",
    variants: ["torah", "tawrat"],
    translit: "Tawrāh",
    arabic: "توراة",
    short: "The scripture revealed to Moses.",
    detail: "'We gave Moses the scripture (tawrah) saying: You are a messenger' (20:113-114).",
    category: 'terms',
    refs: ["quran:20:1:114", "quran:5:1:44"],
  },
  {
    term: "Zabur",
    variants: ["zabur", "psalm", "psalms"],
    translit: "Zabūr",
    arabic: "زبور",
    short: "The Psalms, revealed to David.",
    detail: "'And to David We gave the Zabur' (4:163) - the only other prophet named as receiving a book in that verse.",
    category: 'terms',
    refs: ["quran:4:1:163", "quran:21:1:105"],
  },
  {
    term: "Gospel",
    variants: ["gospel", "injil"],
    translit: "Injīl",
    arabic: "إنجيل",
    short: "The scripture revealed to Jesus.",
    detail: "'And We gave Jesus, son of Mary, the Injil, containing guidance and light' (5:46).",
    category: 'terms',
    refs: ["quran:5:1:46", "quran:5:1:47"],
  },
  {
    term: "Furqan",
    variants: ["furqan", "criterion", "the criterion"],
    translit: "Furqān",
    arabic: "فرقان",
    short: "The criterion that distinguishes right from wrong.",
    detail: "'Blessed is He who sent down the Criterion (furqan) upon His servant' (25:1) - a name for the Qur'an.",
    category: 'terms',
    refs: ["quran:25:1:1", "quran:17:1:16"],
  },
  {
    term: "Quran",
    variants: ["quran", "qur'an"],
    translit: "Qur'ān",
    arabic: "قرآن",
    short: "The scripture revealed to the Prophet Muhammad.",
    detail: "From qara'a, 'to recite aloud'. Called the Criterion, the Reminder, the Light, and 'the Speech of the Merciful' (55:10).",
    category: 'terms',
    refs: ["quran:2:1:87", "quran:17:1:88"],
  },
  {
    term: "Holy Spirit",
    variants: ["holy spirit", "spirit of holiness"],
    translit: "Rūḥ al-Qudus",
    arabic: "روح القدس",
    short: "The Spirit sent to Jesus and to the Apostles.",
    detail: "Named as the Spirit of the Truth (2:102) and the Holy Spirit (5:104).",
    category: 'terms',
    refs: ["quran:2:1:102", "quran:5:1:104"],
  },
  {
    term: "Script and handwriting",
    variants: ["handwriting", "written record"],
    translit: "Kitāb",
    arabic: "كتاب",
    short: "A written record; also 'book' for a destined decree.",
    detail: "kitab means 'a written thing' and by extension 'a book' and 'a decree' - as in the unaltered 'Book' (kitab) of the beginning (6:59).",
    category: 'terms',
    refs: ["quran:6:1:59", "quran:2:1:78"],
  },
  {
    term: "Verse",
    variants: ["verse", "verses", "ayat"],
    translit: "Āyah",
    arabic: "آية",
    short: "A verse of the Qur'an; also a sign of God.",
    detail: "The root means 'to pass, to come'. Every verse of the Qur'an is itself a sign, which is why the same word carries both senses.",
    category: 'terms',
    refs: ["quran:2:1:255", "quran:2:1:256"],
  },
  {
    term: "Night",
    variants: ["layl", "night", "nights"],
    translit: "Layl",
    arabic: "ليل",
    short: "Night; paired with the day as one of the paired things the Prophet swore by.",
    detail: "'By the night when it covers' (79:1) - layl is paired with the day in Surah al-Layl (91), and night is one of the created signs (2:164).",
    category: 'cosmos',
    refs: ["quran:91:1:1", "quran:79:1:1"],
  },
  {
    term: "Dawn",
    variants: ["dawn", "daybreak", "morning", "fajr"],
    translit: "Fajr",
    arabic: "فجر",
    short: "Root f-j-r: to scatter, to burst out. The break of day.",
    detail: "The pre-dawn prayer, Fajr, takes its name from the same root; and at dawn one asks forgiveness (3:17).",
    category: 'practice',
    refs: ["quran:2:1:177", "quran:3:1:17"],
  },
  {
    term: "The Messenger",
    variants: ["the messenger", "messenger of allah"],
    translit: "Rasūl Allāh",
    arabic: "رسول الله",
    short: "The title of the Prophet Muhammad, the final messenger.",
    detail: "Brought not a new law but a confirmation ('confirming what was before it') of the earlier scriptures (2:89; 46:35).",
    category: 'people',
    refs: ["quran:2:1:89", "quran:46:1:35"],
  },
  {
    term: "Straight path",
    variants: ["straight path", "straight ways"],
    translit: "Ṣirāṭ",
    arabic: "صراط",
    short: "Root ṣ-r-ṭ: to be firm, to be straightforward. A clear way.",
    detail: "'Guide us to the straight path - the path of those You have blessed' (1:7-9). Qur'anic Sura Fatihah asks for it, so it is one of the most repeated Qur'anic terms.",
    category: 'terms',
    refs: ["quran:1:1:7", "quran:6:1:16"],
  },
  {
    term: "Falsehood",
    variants: ["falsehood", "false", "lying", "lies", "lies"],
    translit: "Kadhib",
    arabic: "كذب",
    short: "Root k-dh-b: to lie, to refute. Untruth.",
    detail: "'They gave a short discount (kadhib) in the world of the Hereafter' (3:90) - the word is used of commerce.",
    category: 'terms',
    refs: ["quran:3:1:90", "quran:2:1:11"],
  },
  {
    term: "Hearts",
    variants: ["hearts", "heart"],
    translit: "Qalb",
    arabic: "قلب",
    short: "Root q-l-b: to turn. The seat of understanding and intention.",
    detail: "Because the root means 'to turn', the Qur'an speaks of hearts that 'turn' - sealed, hardened, diseased, or made whole (2:10; 26:9).",
    category: 'terms',
    refs: ["quran:2:1:10", "quran:26:1:9"],
  },
  {
    term: "Bosom",
    variants: ["bosom", "breast", "chest", "bosoms"],
    translit: "Ṣadr",
    arabic: "صدر",
    short: "Root ṣ-d-r: to expand, to open. The chest, and the heart within it.",
    detail: "'Whoever has expanded for him his chest in Islam' (39:53) - the Qur'an speaks of the heart being opened to guidance.",
    category: 'terms',
    refs: ["quran:39:1:53", "quran:2:1:5"],
  },
  {
    term: "Vision",
    variants: ["vision", "visions"],
    translit: "Ru'yah",
    arabic: "رؤيا",
    short: "A dream or vision seen by a prophet.",
    detail: "Distinguished from the 'dream of the ordinary' - Joseph distinguishes his dream (12:5); and the Prophet's Great Vision is al-Isra (17:1).",
    category: 'terms',
    refs: ["quran:12:1:5", "quran:17:1:1"],
  },
  {
    term: "Dream",
    variants: ["dream", "dreams"],
    translit: "Manām",
    arabic: "منام",
    short: "A dream during sleep.",
    detail: "Distinguished from the 'daydream' of the heart and from the truthful 'vision' of a prophet.",
    category: 'terms',
    refs: ["quran:2:1:102", "quran:12:1:100"],
  },
  {
    term: "Arrogance",
    variants: ["arrogance", "arrogant", "arrogant", "pride"],
    translit: "Istakbar",
    arabic: "استكبار",
    short: "Root s-k-b-r: to be great, to swell. Pride that resists truth.",
    detail: "Qar'un (Korah) is its archetype, destroyed 'because he was one of those who were arrogant' (28:42).",
    category: 'virtue',
    refs: ["quran:28:1:42", "quran:31:1:21"],
  },
  {
    term: "Seal and signet",
    variants: ["signet ring", "sealing", "sealed"],
    translit: "Khātam",
    arabic: "خاتم",
    short: "A seal or signet; the Prophet is called 'a ring and a seal that concludes' (33:21).",
    detail: "Used of hearts sealed against the truth (2:7) and of the Prophet as 'a ring and a seal', whose seal is the Qur'an. The ordinary English noun 'ring' is deliberately not highlighted, because it appears too often in unrelated senses to be a reliable marker.",
    category: 'people',
    refs: ["quran:33:1:21", "quran:2:1:7"],
  },
  {
    term: "Inheritance",
    variants: ["heirs", "heir", "inheritance", "inheritors", "inherited"],
    translit: "Mīrāth",
    arabic: "ميراث",
    short: "Root m-w-r-th: to succeed, to inherit. The estate of the deceased.",
    detail: "'And from what is left to the heirs' (4:11) - used in the extensive laws of inheritance (4:7-12).",
    category: 'practice',
    refs: ["quran:4:1:11", "quran:4:1:7"],
  },
  {
    term: "Scholar",
    variants: ["scholar", "scholars", "learned", "ulema"],
    translit: "'Ālim",
    arabic: "عالم",
    short: "Root '-l-m: to know. One who knows.",
    detail: "Knows in the passive, 'he was taught'; and active, 'he is a scholar of the people of the Book' (3:39).",
    category: 'people',
    refs: ["quran:3:1:39", "quran:9:1:14"],
  },
];

/*
 * Matching
 */

/**
 * One marked run of text, or the plain text between two of them.
 *
 * `entry` is null for plain runs, so the renderer can map straight over segments
 * without re-testing the text.
 */
export type GlossarySegment =
  | { kind: 'plain'; text: string }
  | { kind: 'term'; text: string; entry: GlossaryEntry };

/**
 * Built once at module load. 129 entries is small enough that matching a passage
 * costs a pass over its words rather than a request, which is what keeps the
 * reading view free of a lookup per word.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type CompiledEntry = { re: RegExp; entry: GlossaryEntry };

/**
 * Fold one character to ASCII if it differs from ASCII only by diacritics.
 *
 * The corpus writes "Allāh" with U+0101, and a bare ASCII variant list would
 * never match the single most common word in the Quran. Folding has to be
 * character-by-character: folding the whole string with NFD would shorten it
 * wherever the source already carries combining marks, and every match offset
 * after that point would point into the wrong word.
 */
function foldChar(ch: string): string {
  const stripped = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Only accept a fold that is still exactly one character, so offsets hold.
  return stripped.length === 1 ? stripped : ch;
}

function foldLatin(text: string): string {
  let out = '';
  for (const ch of text) out += foldChar(ch);
  return out;
}

const COMPILED: CompiledEntry[] = GLOSSARY.map((entry) => {
  // Longest first, so a four-word phrase is not pre-empted by a two-word term
  // sitting inside it.
  const variants = [...entry.variants].sort((a, b) => b.length - a.length);
  const source = `(?<![A-Za-z])(?:${variants.map(escapeRegExp).join('|')})(?![A-Za-z])`;
  // No \b: it would not fire next to an apostrophe, and the translation writes
  // possessives ("the believer's") that a reader still expects to be marked.
  // The explicit ASCII look-arounds do the same job without that gap.
  return { re: new RegExp(source, entry.caseSensitive ? 'g' : 'gi'), entry };
});

const BY_TERM = new Map(GLOSSARY.map((entry) => [entry.term, entry]));

export function glossaryEntry(term: string): GlossaryEntry | undefined {
  return BY_TERM.get(term);
}

export function glossaryTermsIn(text: string): string[] {
  const found: string[] = [];
  const haystack = foldLatin(text);
  for (const { re, entry } of COMPILED) {
    re.lastIndex = 0;
    if (re.test(haystack) && !found.includes(entry.term)) found.push(entry.term);
  }
  return found;
}

/**
 * Split translation text into plain and glossary runs.
 *
 * Longer matches win, and overlapping candidates are dropped rather than
 * nested, so a reader never sees two definitions for one word.
 *
 * Matching runs on the folded text but the segments carry the original
 * characters, which is safe because foldLatin preserves length exactly.
 */
export function segmentForGlossary(text: string): GlossarySegment[] {
  if (!text) return [];

  const haystack = foldLatin(text);
  const candidates: { start: number; end: number; entry: GlossaryEntry }[] = [];
  for (const { re, entry } of COMPILED) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(haystack)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      candidates.push({ start: m.index, end: m.index + m[0].length, entry });
    }
  }
  if (candidates.length === 0) return [{ kind: 'plain', text }];

  candidates.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  const segments: GlossarySegment[] = [];
  let cursor = 0;
  let lastEnd = -1;
  for (const c of candidates) {
    if (c.start < lastEnd) continue;
    if (c.start > cursor) segments.push({ kind: 'plain', text: text.slice(cursor, c.start) });
    segments.push({ kind: 'term', text: text.slice(c.start, c.end), entry: c.entry });
    cursor = c.end;
    lastEnd = c.end;
  }
  if (cursor < text.length) segments.push({ kind: 'plain', text: text.slice(cursor) });

  return segments;
}

/**
 * The texts whose English translations this glossary describes.
 *
 * The entries are Quranic, and several gloss terms the Quran uses in a specific
 * sense - "messenger", "righteous", "scripture". Offering them on a Hebrew or
 * Greek translation would attach a Quranic definition to a word carrying a
 * different one, which is the kind of quiet misreading this library exists to
 * avoid. Other texts keep the existing original-text lookup instead.
 */
export const GLOSSARY_TEXTS = new Set(['quran']);
