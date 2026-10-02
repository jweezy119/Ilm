"""Reading glossary for Quranic terms appearing in the English translations.

Every entry was chosen from a frequency analysis of the en.sahih translation
corpus (6,236 verses), so the list reflects the words a reader actually meets
often enough to need help with, rather than a generic dictionary.

Each entry carries:
  term      - canonical name shown in the Glossary tab
  variants  - surface forms that occur in the translation, plus the common
              transliterated Arabic (so both "alms" and "zakat" resolve)
  translit  - Arabic transliteration
  arabic    - Arabic script
  short     - one-line gloss, used for the inline popover
  detail    - fuller note, shown when the reader expands an entry
  category  - grouping for browsing
  refs      - notable verses, verified against the corpus by validate_glossary
"""

from typing import Dict, List, Optional
import re

# --------------------------------------------------------------------------
# Entry data
# --------------------------------------------------------------------------

DIVINE = "Divine & worship"
VIRTUE = "Virtue & character"
AFTERLIFE = "Afterlife"
PEOPLE = "People & roles"
PRACTICE = "Law & practice"
COSMOS = "Creation & cosmos"
TERMS = "Terms & concepts"

ENTRIES: List[Dict] = [
    # ---------------- Divine names & worship ----------------
    dict(term="Allah", variants=["allah"], translit="Allāh", arabic="الله",
         short="The Arabic word for God; literally 'the One worthy of worship'.",
         detail="Used throughout the Qur'an as the personal name of the one God. Related names include al-Rahman (the Especially Merciful) and al-Rahim (the Especially Merciful, again).",
         category=DIVINE, refs=["1:1", "2:255"]),
    dict(term="Lord", variants=["lord"], translit="Rabb", arabic="رب",
         short="One who sustains and governs; the title used for the one God.",
         detail="From a root meaning 'to be attached to' or 'to care for'. In the Qur'an it conveys both lordship (ownership and authority) and the sustaining care of a master over a servant.",
         category=DIVINE, refs=["1:2", "2:16"]),
    dict(term="Most Merciful", variants=["most merciful", "especially merciful"], translit="al-Raḥmān / al-Raḥīm", arabic="الرحمن الرحيم",
         short="Two of the ninety-nine names; opening the Qur'an with them.",
         detail="al-Rahman is the vast, universal mercy; al-Rahim is the specific, particular mercy. The phrase opens every surah except one (At-Tawbah).",
         category=DIVINE, refs=["1:1", "1:3"]),
    dict(term="Grateful", variants=["grateful", "gratitude", "thankful", "ungrateful"], translit="Shākir", arabic="شاكر",
         short="One who gives thanks; ingratitude is its opposite.",
         detail="The Qur'an repeatedly links remembrance (dhikr) with gratitude, treating the two as two sides of acknowledging God's favour.",
         category=VIRTUE, refs=["2:152", "14:7"]),
    dict(term="Exalted", variants=["exalted", "majesty", "sublime"], translit="al-ʿAẓīm", arabic="العظيم",
         short="One of the names of God; also used of the Prophet in 9:40.",
         detail="Literally 'the magnified'. Paired in the Qur'an with al-Ghafur (the All-Forgiving), as in 'the Exalted, the All-Forgiving'.",
         category=DIVINE, refs=["13:9", "59:23"]),
    dict(term="Sustainer", variants=["sustainer", "provider", "preserver"], translit="al-Razzīq", arabic="الرزاق",
         short="One who provides for all creation.",
         detail="The Urdu-speaking tradition often renders this as rizq (provision, sustenance) rather than the name-form.",
         category=DIVINE, refs=["51:58"]),
    dict(term="Almighty", variants=["almighty", "mighty", "all-mighty", "omnipotent"], translit="al-Qahhār", arabic="القهار",
         short="One who dominates; the root q-h-r recurs in God's names.",
         detail="al-Qahhar, 'the Subduer', appears at the close of Surah al-Hajj.",
         category=DIVINE, refs=["40:16"]),
    dict(term="Forbearing", variants=["forbearing", "forgives", "all-forgiving"], translit="al-Ḥalīm", arabic="الحليم",
         short="One who bears with His servants and does not punish hastily.",
         detail="Often paired with al-ʿAzīm in the closing verses of al-Baqarah.",
         category=DIVINE, refs=["2:263", "42:15"]),
    dict(term="Merciful", variants=["merciful", "mercy", "compassionate"], translit="Raḥmān / Raḥīm", arabic="رحمن رحيم",
         short="Root r-ḥ-m: tenderness, the quality of being moved to help.",
         detail="Covers both divine mercy and the human mercy (rahma) of mothers, compassion and the mercy of an animal, and even the mercy shown by wild beasts.",
         category=DIVINE, refs=["21:107", "12:83"]),

    # ---------------- Worship ----------------
    dict(term="Prayer", variants=["prayer", "prayed", "prayers", "pray"], translit="Ṣalāh", arabic="صلاة",
         short="The ritual worship of Islam, performed five times a day.",
         detail="From a root meaning 'to closely follow, to be in constant connection'. It includes the physical postures, the recitation, and the turning of the heart.",
         category=DIVINE, refs=["29:45", "4:103"]),
    dict(term="Zakat", variants=["alms", "alms-tax", "zakat", "charity-tax", "alms-tax"], translit="Zakāh", arabic="زكاة",
         short="Obligatory almsgiving on wealth; one of the five pillars.",
         detail="From a root meaning 'growth' or 'increase' - giving alms that grows the giver's standing. The exact rate depends on the type and age of the wealth.",
         category=PRACTICE, refs=["2:263", "9:60"]),
    dict(term="Fasting", variants=["fasting", "fast", "fasted", "sawm"], translit="Ṣawm", arabic="صوم",
         short="Abstaining from food and drink with the intention of worship.",
         detail="Its root w-s-m also covers 'confinement' and 'preclusion', as in the fast of Moses. The Qur'an uses the word for both fasting and for the month of Ramadan.",
         category=PRACTICE, refs=["2:183", "19:54"]),
    dict(term="Pilgrimage", variants=["pilgrimage", "pilgrim", "hajj"], translit="Ḥajj", arabic="حج",
         short="The once-a-year journey to Makkah; one of the five pillars.",
         detail="The root ḥ-j-j suggests 'to intend toward' or 'to head for', and carries the sense of a deliberate journey.",
         category=PRACTICE, refs=["2:196", "22:27"]),
    dict(term="Worship", variants=["worship", "worshipped", "worshiper"], translit="ʿIbādah", arabic="عبادة",
         short="Obedience and submission in ritual; the Qur'an uses it broadly for all devotion.",
         detail="Used not only for ritual prayer but for any submission to God, including internal and ethical devotion.",
         category=DIVINE, refs=["2:183", "16:36"]),
    dict(term="Supplication", variants=["supplication", "invocation"], translit="Duʿāʾ", arabic="دعاء",
         short="Asking of God directly; described as the essence of worship.",
         detail="A prophetic supplication 'O Allah, I ask You for guidance and righteousness' opens an extended section of Surah al-Furqan (25:74).",
         category=DIVINE, refs=["25:74", "40:60"]),
    dict(term="Precedent", variants=["precedent", "sunnah"], translit="Sunnah", arabic="سنة",
         short="The established practice or precedent; used of the Prophet's own pattern.",
         detail="In the Qur'anic sense the term covers custom and precedent as a binding model to be followed, whether human or prophetic.",
         category=TERMS, refs=["59:12", "43:22"]),
    dict(term="Abrogation", variants=["abrogate", "abrogating", "abrogated", "supersedes"], translit="Naskh", arabic="نسخ",
         short="One rule replacing an earlier one; a technical term of Qur'anic law.",
         detail="Discussed at 2:106, where a rule that was beneficial is replaced by one more binding, and the whole Book belongs to its Lord.",
         category=TERMS, refs=["2:106"]),
    dict(term="Abomination", variants=["abomination", "abominable", "impure"], translit="Najas", arabic="نجاسة",
         short="Filth or impurity; also used for something ritually unclean.",
         detail="Its antonym ṭahārah, purity, governs a large part of the legal discussion of Ma'idah.",
         category=PRACTICE, refs=["2:222"]),

    # ---------------- Virtue ----------------
    dict(term="Righteous", variants=["righteous", "pious", "godly"], translit="Ṭāqī / Ṣāliḥ", arabic="متق / صالح",
         short="God-conscious: one who guards against evil.",
         detail="The Qur'an rarely uses taqwa for ritual observance and mainly for an inner guarding of the heart. Ṣāliḥ, 'sound or wholesome', is the related word used of prophets and of the righteous.",
         category=VIRTUE, refs=["2:2", "9:108", "12:55"]),
    dict(term="Purity", variants=["purity", "pure", "clean", "purified"], translit="Ṭahārah", arabic="طهارة",
         short="Ritual and spiritual cleanliness.",
         detail="The word opens Surah Taha and is the term for both the state of being clean and the act of purifying. Its opposite is najasah, abomination.",
         category=PRACTICE, refs=["20:14", "56:79"]),
    dict(term="Taqwa", variants=["taqwa", "god-consciousness"], translit="Taqwā", arabic="تقوى",
         short="God-consciousness; guarding the heart against sin.",
         detail="The transliterated form is not used by most English translations, so this entry is here for reference when reading tafsir or Arabic sources. The Quranic sense is given by 49:11: taqwa is 'that by which falsehood is forbidden to the soul'.",
         category=VIRTUE, refs=["49:13", "2:2"]),
    dict(term="Patience", variants=["patience", "patient", "steadfast"], translit="Ṣabr", arabic="صبر",
         short="Endurance; steadiness under difficulty.",
         detail="Taqwa and patience are paired repeatedly. Patience is praised in three forms: patience in obedience, patience away from disobedience, and patience with hardship.",
         category=VIRTUE, refs=["2:153", "18:68"]),
    dict(term="Steadfastness", variants=["steadfastness", "firmness", "steadiness"], translit="Qawwīyyah", arabic="قوة",
         short="Firmness of purpose; being rooted.",
         detail="Root q-w-y means 'to be strong, to have weight'. The Qur'an asks God for 'firmness of purpose and resolve'.",
         category=VIRTUE, refs=["19:4", "11:43"]),
    dict(term="Forgiveness", variants=["forgiveness", "forgive", "forgiven", "pardoned", "pardon"], translit="ʿAfw", arabic="عفو",
         short="Pardoning an offence without punishment.",
         detail="ʿAfw names the act, while maghfirah names the pardon or forgiveness granted, and it is often paired with māl, 'to leave unpunished'.",
         category=VIRTUE, refs=["24:22", "42:40"]),
    dict(term="Mercy in speech", variants=["good speech", "kind speech", "gracious word"], translit="Kalīmah Ṭayyibah", arabic="كلمة طيبة",
         short="A good word that sows goodness, as a tree that puts out fruit.",
         detail="The image is given of a good word as a tree whose roots are firm and whose branches reach the sky (14:24).",
         category=VIRTUE, refs=["14:24", "16:97"]),
    dict(term="Humility", variants=["humble", "humility", "modest"], translit="Khushuʿ", arabic="خشوع",
         short="Inward stillness and attentiveness in worship.",
         detail="khushuʿ is linked to the heart and to the eyes lowered during prayer - the opposite of distractedness (ghaflah).",
         category=VIRTUE, refs=["2:222", "23:2"]),
    dict(term="Truthfulness", variants=["truthful", "truthfulness", "honest", "honesty"], translit="Ṣidq", arabic="صدق",
         short="Root ṣ-d-q: to be true, to be aligned with reality.",
         detail="Truthfulness is presented as inherently paired with faithfulness - 'be true to God even against yourselves'.",
         category=VIRTUE, refs=["4:69", "17:33"]),
    dict(term="Trustworthiness", variants=["trustworthy", "trustworthiness", "entrusted", "entrusts", "render trusts"], translit="Amānah", arabic="أمانة",
         short="Faithfulness; something entrusted, to be returned intact.",
         detail="From the root a-m-n, 'to be safe, secure, trustworthy', which also gives amin, 'peace', and iman, 'faith'. The covenant entrusted to the heavens and the earth is an amanah (33:7). Note: the ordinary English word 'trust' on its own is not the Qur'anic term and is not highlighted.",
         category=VIRTUE, refs=["4:58", "33:7", "33:72"]),
    dict(term="Injustice", variants=["injustice", "unjust", "oppress", "oppressed", "wrongdoer", "wronged", "transgress"], translit="Ẓulm", arabic="ظلم",
         short="Root ḍ-l-m: to put something in the wrong place, to exceed bounds.",
         detail="Used for placing a thing where it does not belong, in the body, in the world, or in a relationship - and so for wronging people, or even a soul wronging itself.",
         category=VIRTUE, refs=["2:217", "4:22"]),
    dict(term="Remembrance", variants=["remembrance", "remember", "remembers", "reminded"], translit="Dhikr", arabic="ذكر",
         short="Mentioning God by any means: with the tongue, in thought, or in action.",
         detail="Root dh-k-r, from 'a horse with no rider', which is quiet until its rider returns; the Qur'an uses the word for remembering and for the Qur'an itself.",
         category=DIVINE, refs=["2:152", "73:8"]),
    dict(term="Repentance", variants=["repentance", "repent", "repented"], translit="Tawbah", arabic="توبة",
         short="Turning back to God in regret and resolve.",
         detail="Root t-w-b means 'to turn'. The Qur'an adds a condition: turning back before the soul reaches the throat, or before the sun rises from its west.",
         category=VIRTUE, refs=["9:104", "4:18"]),
    dict(term="Sin", variants=["sin", "sins", "transgression", "transgressions"], translit="Ithm", arabic="إثم",
         short="Root '-th-m: to bring harm or loss upon oneself.",
         detail="The Qur'an lists major sins - shirk, murder, fornication, false accusation of the chaste, theft - and weighs lesser deeds by their intention.",
         category=TERMS, refs=["6:151", "17:31"]),
    dict(term="Major sin", variants=["major sins", "greater sins"], translit="Ithm Kabīr", arabic="إثم كبير",
         short="The gravest offences, which the Qur'an names explicitly.",
         detail="'If you avoid the major sins which you are forbidden, We will remove from you your misdeeds' (39:53). The list is given at 6:151 and 17:31-33.",
         category=TERMS, refs=["39:53", "6:151"]),
    dict(term="Unlawful sexual intercourse", variants=["adultery", "unlawful sexual intercourse", "fornication", "adulterer", "adulteress"], translit="Zinā", arabic="زنا",
         short="Illicit sexual intercourse; the term also covers the false accusation of it.",
         detail="Root z-y-n, meaning both 'to commit fornication' and 'to accuse falsely' - so accusing a chaste person of zina is itself zina. Named explicitly among the major sins (17:21).",
         category=PRACTICE, refs=["17:21", "4:15"]),

    # ---------------- Afterlife ----------------
    dict(term="Hereafter", variants=["hereafter", "afterlife", "the hereafter"], translit="Ākhirah", arabic="آخرة",
         short="The next world, in contrast with this world (dunya).",
         detail="Root '-kh-r means 'the other, the later one'. The contrast dunya and akhirah runs through the whole Qur'an.",
         category=AFTERLIFE, refs=["2:212", "2:4"]),
    dict(term="Worldly", variants=["worldly", "dunya", "life of this world"], translit="Dunyā", arabic="دنيا",
         short="This present life; the Qur'an never condemns it, only its excess.",
         detail="'Enjoyment of the world' - the point is not that the world is forbidden but that it is transient and meant to be a passage.",
         category=AFTERLIFE, refs=["21:35", "57:20"]),
    dict(term="Paradise", variants=["paradise", "gardens", "garden", "gardens of"], translit="Jannah", arabic="جنّة",
         short="Root j-n-n: to be hidden or covered; the garden of the Hereafter.",
         detail="The root's sense of covering fits the Qur'anic description of Paradise as hidden from human sight.",
         category=AFTERLIFE, refs=["2:35", "76:12"]),
    dict(term="Hellfire", variants=["hellfire", "hell", "blazing fire", "the fire"], translit="Jahannam", arabic="جهنم",
         short="The fire of the Hereafter; an Arabic formation meaning 'the veiled thing'.",
         detail="The root j-h-n-m suggests 'a veil of smoke'. It is called the Fire that glows and the Fire that climbs.",
         category=AFTERLIFE, refs=["82:15", "55:55"]),
    dict(term="Reward", variants=["reward", "recompense", "rewards"], translit="Ajr", arabic="أجر",
         short="Root '-j-r: to return, to bring back.",
         detail="Because the root implies 'a return', the Qur'an connects reward with resurrection: the return is itself the payment.",
         category=AFTERLIFE, refs=["3:195", "34:22"]),
    dict(term="Good deeds", variants=["good deeds", "righteous deeds", "deeds", "good deed"], translit="Ḥasanāt", arabic="حسنات",
         short="Root ḥ-s-n: to be beautiful or good in quality.",
         detail="The word ḥasanat is used for a woman's good deeds as well as for a good deed in the plural, and for the beautiful in both senses.",
         category=AFTERLIFE, refs=["4:4", "2:110"]),
    dict(term="Resurrection", variants=["resurrection", "resurrect", "resurrected", "raised from the dead"], translit="Qiyāmah", arabic="قيامة",
         short="The Day of Standing, when the dead are raised.",
         detail="From q-y-m, 'to stand'. The Qur'an uses it for the Day itself and for the rising of the soul. Note the bare English word 'raised' is deliberately not highlighted, since it is too common to be a reliable marker.",
         category=AFTERLIFE, refs=["2:85", "75:40"]),
    dict(term="The Hour", variants=["hour", "last day", "day of judgment", "day of judgement", "day of reckoning"], translit="Sāʿah", arabic="ساعة",
         short="The Hour; the decisive moment of judgement.",
         detail="Also called the qiyamah; both terms appear in the same breath in verses such as 4:1 and 6:60. Sa'ah is also an ordinary unit of time, so only eschatological senses are highlighted here.",
         category=AFTERLIFE, refs=["4:1", "6:60"]),
    dict(term="Judgement", variants=["judgement", "judgment", "reckoning", "account"], translit="Qist", arabic="قسط",
         short="Root q-s-t: to measure, to weigh, to divide justly.",
         detail="The weighing on judgement day - the scale placed to be weighed on, where the deeds themselves speak (21:101).",
         category=AFTERLIFE, refs=["21:101", "3:18"]),
    dict(term="Scale", variants=["scale", "scales", "balance", "balanced"], translit="Mīzān", arabic="ميزان",
         short="A balance; also metaphor for justice and for the Qur'an itself.",
         detail="God and His messengers set up the balance - taken twice in the same verse (55:7-9) to make the point that justice is a joint responsibility.",
         category=TERMS, refs=["55:7", "17:18"]),
    dict(term="Wrongdoers", variants=["wrongdoers", "transgressors", "sinners", "sinful"], translit="Ẓālimūn", arabic="ظالمون",
         short="The plural of zulm: those who transgress and wrong.",
         detail="Part of the Qur'an's running contrast between the believers and the wrongdoers.",
         category=TERMS, refs=["2:58", "3:112"]),
    dict(term="Intercession", variants=["intercession", "intercede", "intercessor"], translit="Shafāʿah", arabic="شفاعة",
         short="Root sh-f-w, 'to ask together, to intercede for'. The word also means shyness or coyness.",
         detail="The Qur'an teaches that no intercession happens except by God's permission, and that He may withhold it (74:48).",
         category=AFTERLIFE, refs=["74:48", "5:35"]),
    dict(term="Fuel", variants=["fuel", "wood for the fire"], translit="Wazīʿ", arabic="وقود",
         short="Fuel: both firewood for the fire and fuel for metaphor.",
         detail="'Fuel for the fire' is applied both to wood and to people - disbelievers described as fuel (70:15-16).",
         category=AFTERLIFE, refs=["70:16", "11:3"]),
    dict(term="Evil", variants=["evil", "evils", "evil deed", "evil deeds", "evil-doing"], translit="Shar", arabic="شر",
         short="Root sh-r-r: to flow, to spread. Used for both moral evil and physical harm.",
         detail="Used of a scorpion's sting as well as of wrongdoing - the Qur'an uses the same word for harm and for moral evil. Its counterpart is hasan, goodness.",
         category=TERMS, refs=["55:59", "4:49"]),

    # ---------------- People ----------------
    dict(term="Messenger", variants=["messenger", "messengers"], translit="Rasūl", arabic="رسول",
         short="One sent with a message; the title of the Prophet Muhammad.",
         detail="Root r-s-l means 'to send'. Also used for angels and for Messengers such as Jesus, Moses, and Noah.",
         category=PEOPLE, refs=["33:40", "2:87"]),
    dict(term="Prophet", variants=["prophet", "prophets"], translit="Nabī", arabic="نبي",
         short="From n-b-a: to announce, to give news. A prophet receives revelation and conveys it.",
         detail="The root points to 'coming', suggesting 'he was sent'. The word 'weeping' in the term 'weeping prophet' (25:8) is debated among scholars.",
         category=PEOPLE, refs=["4:163", "25:7"]),
    dict(term="Believer", variants=["believer", "believers", "believed", "believe", "believing"], translit="Mu'min", arabic="مؤمن",
         short="One who has faith; from amn, security and peace.",
         detail="The root is also the source of 'peace' (salam) and safety, and the Qur'an links belief with peace in 4:131.",
         category=PEOPLE, refs=["2:2", "4:131"]),
    dict(term="Disbeliever", variants=["disbeliever", "disbelievers", "disbelief", "disbelieved", "denied", "unbeliever"], translit="Kāfir", arabic="كافر",
         short="One who denies; from k-f-r, to cover or deny.",
         detail="'To cover' is the root sense - the denial that 'covers' the truth. It is a word for rejecting God, not for doubting about trivia.",
         category=PEOPLE, refs=["2:108", "40:70"]),
    dict(term="Hypocrite", variants=["hypocrite", "hypocrites", "hypocrisy"], translit="Munāfiq", arabic="منافق",
         short="One who professes faith outwardly while working against it inwardly.",
         detail="From n-f-q, meaning 'to exit, to diverge'. Used especially of the Prophet's companions who outwardly confirmed and inwardly conspired.",
         category=PEOPLE, refs=["9:54", "9:101"]),
    dict(term="Servant", variants=["servant", "servants"], translit="ʿAbd", arabic="عبد",
         short="One who is bound and subject; a servant of God.",
         detail="'Abd Allah is often rendered 'servant of God'. The term also became a proper name for the third caliph, Uthman.",
         category=PEOPLE, refs=["2:26", "16:1"]),
    dict(term="Witness", variants=["witness", "witnesses", "witnessed", "testimony"], translit="Shāhid", arabic="شهيد",
         short="Root sh-h-d: to testify, to bear witness. Also a martyr.",
         detail="The root gives both 'witness' and 'martyr', which is how the word came to mean one who dies for the faith.",
         category=PEOPLE, refs=["2:143", "3:18"]),
    dict(term="Enmity", variants=["enmity", "enemies", "enemy", "hatred", "hostility"], translit="'Adāwah", arabic="عداوة",
         short="Root '-d-w: to cross, to oppose. Enmity is a crossing over against.",
         detail="The Qur'an speaks of placing an enmity between the tribes of the believers and the disbelievers, and between the people of the book (3:69).",
         category=TERMS, refs=["3:69", "18:34"]),
    dict(term="Command", variants=["command", "commands", "commanded", "ordered"], translit="Amr", arabic="أمر",
         short="Root '-m-r: to order, to command, to make matter of.",
         detail="Often paired with nahy, prohibition - 'commanded what is good and forbidden what is evil' (2:134).",
         category=TERMS, refs=["2:134", "7:157"]),
    dict(term="Knowledge", variants=["knowledge"], translit="ʿIlm", arabic="علم",
         short="Root '-l-m: to know with certainty, to mark, to distinguish.",
         detail="The Quranic story of the servants of the Two Gardens, who were given knowledge 'and used it to choose themselves over their own souls' (20:122), frames knowledge as moral agency.",
         category=TERMS, refs=["20:122", "58:11"]),
    dict(term="Wisdom", variants=["wisdom", "wise"], translit="Ḥikmah", arabic="حكمة",
         short="Root ḥ-k-m: to prevent, to bind. Wisdom is sound judgment that restrains from excess.",
         detail="The Qur'an says wisdom was given to Luqman the Wise, and to Muhammad (31:12).",
         category=TERMS, refs=["31:12", "17:23"]),
    dict(term="Guidance", variants=["guidance", "guided", "guide", "guides", "misguided"], translit="Hidāyah", arabic="هداية",
         short="Root h-d-y: to point the way, to lead straight.",
         detail="Guidance is both God's gift ('We do not guide anyone but by Our will') and a human path that is trodden (2:213).",
         category=TERMS, refs=["2:213", "20:82"]),
    dict(term="Precipice", variants=["precipice", "abyss", "bottomless"], translit="Ghāwiyah", arabic="غاوية",
         short="Root gh-w-y: to mislead into error, or the pit into which one falls.",
         detail="'A traveller who loses his way from the path and reaches a barren land' (al-Hajj 22:53) shows the sense of both misguidance and the place it ends in.",
         category=AFTERLIFE, refs=["22:53"]),
    dict(term="Reminder", variants=["reminder", "reminders", "admonition", "exhortation"], translit="Dhikrā", arabic="ذكرى",
         short="Something that recalls; the Qur'an as reminder, and those who remind.",
         detail="From 'to remind' or 'to call to mind' - 'O my people, I am but a clear reminder to you' (26:105).",
         category=PEOPLE, refs=["26:105", "44:23"]),
    dict(term="Atonement", variants=["ransom", "expiation", "atonement"], translit="Kaffārah", arabic="كفارة",
         short="Root k-f-r: to cover, to atone for. An act that covers an offence.",
         detail="The root is the same as that of kufr, 'disbelief' - covering a fault with an act that covers it.",
         category=PRACTICE, refs=["2:178", "2:196"]),
    dict(term="Blood", variants=["blood", "bloods", "spilt"], translit="Damm", arabic="دم",
         short="A soul's blood, held sacred and not to be spilled unjustly.",
         detail="Root d-m-m means 'to flow'. The Qur'an treats a soul as a vessel for blood at 5:6.",
         category=PRACTICE, refs=["5:6", "4:29"]),
    dict(term="Provision", variants=["provision", "sustenance", "sustenance of"], translit="Rizq", arabic="رزق",
         short="Root r-z-q: to cause to flow, to feed. Sustenance for body and soul.",
         detail="'Provision from your Lord' refers both to daily bread and, in the Qur'an's wider sense, to guidance.",
         category=PRACTICE, refs=["51:58", "2:168"]),
    dict(term="Favour", variants=["favour", "favours", "blessing", "blessings", "bounty"], translit="Niʿmah", arabic="نعمة",
         short="Root n-'-m: to give generously, to benefit. Grace given without being earned.",
         detail="The Qur'an frequently couples ni'mah with dhikr - remembering the favour is itself a form of worship.",
         category=TERMS, refs=["16:18", "27:40"]),
    dict(term="Covenant", variants=["covenant", "covenants", "pact", "pacts", "pledge", "testament"], translit="Mithāq / ʿAhd", arabic="ميثاق / عهد",
         short="Root m-th-q and '-h-d: to promise, to bind. A solemn, binding pact.",
         detail="Used for the covenants given to the heavens and the earth (33:7), to the prophets, and to the Children of Israel. 'Ahd Allah is the pledge of allegiance taken at Aqabah (48:10).",
         category=TERMS, refs=["33:7", "48:10", "49:14"]),
    dict(term="Lot and share", variants=["lottery", "stake", "a lot", "lot of"], translit="Qismah", arabic="قسمه",
         short="Root q-s-m: to divide into parts. A share divided by lot.",
         detail="Used for the division of the spoils at Badr, and in the Qur'anic phrase 'lot of the Hereafter' (3:180). The bare word 'lot' is not highlighted on its own, to avoid catching 'a lot of' in ordinary speech.",
         category=TERMS, refs=["3:180", "5:6"]),
    dict(term="Usury", variants=["usury", "usurious", "interest"], translit="Ribā", arabic="ربا",
         short="Root r-b-w: to exceed, to grow. Any unjust increase over what is lent.",
         detail="Prohibited in the Qur'an and repeated in 2:276-279, with the metaphor that 'God has abolished interest and granted increase to the believers'.",
         category=PRACTICE, refs=["2:276", "2:279"]),
    dict(term="Veil", variants=["veil", "veiled", "covered", "covering"], translit="Hijāb", arabic="حجاب",
         short="A screen or curtain; what lies between the eyes and the truth.",
         detail="'Veiled' is the Qur'an's word for disbelievers' hearts, and for modesty before God.",
         category=TERMS, refs=["2:7", "45:16"]),
    dict(term="Light (Nur)", variants=["light upon light", "the light of the heavens", "nur"], translit="Nūr", arabic="نور",
         short="Root n-w-r: to shine. God described as the Light of the heavens and the earth.",
         detail="'Allah is the Light of the heavens and the earth. The parable of His light is as a niche wherein is a lamp; the lamp is in glass' (24:35) - the famous Verse of Light. Only these specific phrases are highlighted; the ordinary English word 'light' is left alone.",
         category=DIVINE, refs=["24:35", "35:21"]),
    dict(term="Whisper", variants=["whisper", "whispered", "whispers", "whispering"], translit="Waswāṣ", arabic="وسواس",
         short="Root s-w-s: to whisper, to hint. The whisper of Satan to the human soul.",
         detail="Qur'anic surah al-Nas names it 'the whisperer when man is heedless' (114:4-6).",
         category=TERMS, refs=["114:4", "7:5"]),
    dict(term="Satan", variants=["satan", "devil", "shaytan", "satans"], translit="Shaytān", arabic="شيطان",
         short="Root sh-y-t-n: to be distant, remote, to be away; the one who is far from truth.",
         detail="Also rendered 'devil'. The plural 'shayatin' refers to the army of satans that supported the disbelievers at Badr.",
         category=PEOPLE, refs=["7:5", "2:102"]),
    dict(term="Envy", variants=["envious", "envy", "jealous", "grudge"], translit="Ḥasūd", arabic="حسود",
         short="Root ḥ-s-d: to covet, to wish for what another has.",
         detail="The Qur'an speaks of those who 'eat the wealth of orphans wrongfully, and when they come to you they say we were only doing our job' (4:10).",
         category=VIRTUE, refs=["4:10", "35:21"]),
    dict(term="Evil eye", variants=["evil eye", "envy of the eye", "eye of envy"], translit="ʿĀyina", arabic="عين",
         short="Root '-y-n: the eye, and by extension envy or harm believed to come through the eye.",
         detail="Often rendered 'the evil eye'. Believed and mentioned in the traditions, and permitted only by God.",
         category=TERMS, refs=["35:21", "3:12"]),

    # ---------------- Cosmos ----------------
    dict(term="Creation", variants=["creation", "created", "creates"], translit="Khalq", arabic="خلق",
         short="Root kh-l-q: to measure, to weigh, to create anew.",
         detail="Because the root means 'to measure and proportion', Qur'anic creation is described as 'measured' (13:16).",
         category=COSMOS, refs=["13:16", "59:24"]),
    dict(term="Soul", variants=["soul", "souls", "spirit", "spirits", "nafs"], arabic="نفس / روح",
         translit="Nafs / Rūḥ", short="The self; the human spirit.",
         detail="nafs runs from 'to breathe' to 'ego'; ruh from 'breath, breeze, relief'. The Qur'an speaks of the soul's commands (12:98).",
         category=PEOPLE, refs=["12:98", "4:1"]),
    dict(term="Angel", variants=["angel", "angels"], translit="Malak", arabic="ملك",
         short="Root m-l-k: to possess, to own, to command. A created being sent to do God's will.",
         detail="Angels are not described as a separate species but as created servants given wings (2:124).",
         category=PEOPLE, refs=["2:124", "35:1"]),
    dict(term="Jinn", variants=["jinn", "jinns"], translit="Jinn", arabic="جن",
         short="Root j-n-n: to be hidden or veiled; a creation made of smokeless fire.",
         detail="Neither wholly human nor angel, and not all jinn are evil. The Qur'an states their twofold division (6:76).",
         category=PEOPLE, refs=["6:76", "72:1"]),
    dict(term="Guardian", variants=["guardian", "guardians", "guardian angels", "guardian angel"], translit="Ḥafīz", arabic="حفيظ",
         short="Root ḥ-f-z: to guard, to preserve. A keeper appointed over each person.",
         detail="'Each of you is a guardian over what is sent before him and what is sent after him' (43:8).",
         category=PEOPLE, refs=["43:8", "11:39"]),
    dict(term="Decree and measure", variants=["destiny", "decree", "decreed", "ordained", "predestined", "preordained"], translit="Qadar", arabic="قدر",
         short="Root q-d-r: to measure, to determine. Measure and appointed share a word.",
         detail="The same root gives qadar, 'measure', and qadr, 'decree', so divine decree and measure are linked by wordplay throughout the Qur'an. 13:11: 'Allah does not change a people until they change what is in themselves'. Note the English word 'will' as in 'the will of God' is not highlighted, since it is too ordinary to be a reliable marker.",
         category=TERMS, refs=["13:11", "54:49", "6:38"]),
    dict(term="Abode", variants=["abode", "abiding place", "resting place", "final home"], translit="Maqām", arabic="مقام",
         short="Root q-w-m: to stand, to stay. A place of standing.",
         detail="'You will reside in the abiding place of the Hereafter' (43:70) - maqam is used both of the standing place and of the residence.",
         category=AFTERLIFE, refs=["43:70", "37:144"]),
    dict(term="Adversity", variants=["adversity", "calamity", "affliction", "hardship"], translit="Bala", arabic="بلاء",
         short="Root b-l-w: to test, to try. A trial sent to test or to purify.",
         detail="The same root gives 'to test' and 'to make clear' - the trial both tries and reveals.",
         category=TERMS, refs=["2:155", "94:5"]),
    dict(term="Trial", variants=["trial", "trials", "trials", "test"], translit="Fitnah", arabic="فتنة",
         short="Root f-t-n: to try with fire, to test. A testing, and hence also a fitna - a trial, an offence, or a dissension.",
         detail="The root's fire-image is taken from metal-working: the tempering of a blade. The word carries both 'trial' and 'strife'.",
         category=TERMS, refs=["8:41", "2:102"]),
    dict(term="Strife", variants=["strife", "corruption", "corrupt", "mischief"], translit="Fasād", arabic="فساد",
         short="Root f-s-d: to exceed, to spread corruption. Disorder in place of right.",
         detail="The Qur'an describes Qur'an itself as 'a word of parting' (fsad) and 'the best speech' - the same root.",
         category=TERMS, refs=["2:108", "7:188"]),
    dict(term="Chastity", variants=["chastity", "chaste"], translit="'Iffah", arabic="عفة",
         short="Root '-f-f: to turn away from, to shun. Modesty and restraint.",
         detail="'Iffah covers sexual restraint and the guarding of the self more broadly, and is the quality praised in the wife of a Pharaoh.",
         category=VIRTUE, refs=["4:24", "66:3"]),
    dict(term="Sacrifice", variants=["sacrifice", "sacrifices", "slaughter", "sacrificial"], translit="Ḍaḥīyah", arabic="ذبيحة",
         short="Root d-b-h: to slaughter, to sacrifice. A slaughtered animal.",
         detail="Used both for ritual slaughter and, metaphorically, for the sacrifice of the son of Ibrahim (37:107).",
         category=PRACTICE, refs=["37:107", "22:34"]),
    dict(term="Sign", variants=["sign", "signs", "portent"], translit="Āyāt", arabic="آيات",
         short="Root '-y-y: to pass, to come, to signify. Signs and verses alike.",
         detail="'Aya' means both a verse of the Qur'an and a sign of God - the word carries 'proof' inside it.",
         category=TERMS, refs=["2:164", "21:30"]),
    dict(term="Miracle", variants=["miracle", "miracles"], translit="Mū'jizah", arabic="معجزة",
         short="Root '-j-z: to hinder, to make impossible. An event that suspends the usual order.",
         detail="The root is the same as that of 'injury' (mūjiz) - a miracle 'disables' the ordinary course of things.",
         category=TERMS, refs=["2:252", "26:33"]),
    dict(term="Orphanhood", variants=["orphan", "orphans", "orphanage"], translit="Yatīm / Yatāmah", arabic="يتيم / يتمة",
         short="Having no father, or no parents; the state of the yatim.",
         detail="Root y-t-m means 'to be bereft, to have no one'. Treating orphans well is praised more often than any other single virtue in the Qur'an, and Surah al-Duha opens by asking about the orphan (93:6).",
         category=PEOPLE, refs=["93:6", "4:2"]),
    dict(term="Homestead", variants=["homestead", "home", "sanctuary"], translit="Bayt", arabic="بيت",
         short="Root b-y-t: to dwell. A house; also used of the Ka'ba, 'the House'.",
         detail="bayt is both the house of a man and the House of God, and the word is used of the Ka'ba at 2:125.",
         category=TERMS, refs=["2:125", "2:127"]),
    dict(term="Kaaba", variants=["kaaba", "ka'ba", "sacred mosque", "sacred house"], translit="Kaʿbah", arabic="كعبة",
         short="The cube-shaped sanctuary at the centre of Islam in Makkah.",
         detail="'The first House established for mankind was the one at Bakkah' (3:96) - ka'ba means a square, cube-shaped building.",
         category=PRACTICE, refs=["3:96", "2:125"]),
    dict(term="Blasphemy", variants=["blasphemy", "blasphemer", "insulted", "slander"], translit="Kufru", arabic="كفر",
         short="Root k-f-r: to cover, to deny. Denial of God.",
         detail="'Those who took a deity besides Me, then they were brought down upon their own selves' - kufr covers both denial and ingratitude.",
         category=TERMS, refs=["4:108", "2:108"]),

    # ---------------- Prophet & scripture names ----------------
    dict(term="Abraham", variants=["abraham", "ibrahim"], translit="Ibrāhīm", arabic="إبراهيم",
         short="The patriarch, ancestor of prophets and a friend of God.",
         detail="Given 'sound judgment' (hikmah) and the title 'father of Arabs'. His prayer is the famous cry of the ancestors: 'Our Lord, accept this from us' (2:127-129).",
         category=PEOPLE, refs=["2:127", "21:69"]),
    dict(term="Moses", variants=["moses", "harun"], translit="Mūsā", arabic="موسى",
         short="The prophet who spoke directly to Allah and led his people from Pharaoh.",
         detail="Called Kalim Allah, 'he who spoke with God'. His story runs from the burning bush to the divided sea.",
         category=PEOPLE, refs=["20:8", "28:7"]),
    dict(term="Noah", variants=["noah", "nuh"], translit="Nūḥ", arabic="نوح",
         short="The prophet of the ark and the first messenger.",
         detail="Called 'the truthful' (2:143 - 'Nuh among the truthful'). He is named in surahs 7, 11, 23, 26, 29, 50, 54, 71.",
         category=PEOPLE, refs=["71:1", "7:59"]),
    dict(term="David", variants=["david", "dawud"], translit="Dāwūd", arabic="داود",
         short="The prophet and king to whom the Zabur (Psalms) was given.",
         detail="'And to David We gave wisdom and the Zabur' (4:163) - the only prophet named as receiving a scripture in that verse.",
         category=PEOPLE, refs=["4:163", "34:11"]),
    dict(term="Solomon", variants=["solomon", "sulayman"], translit="Sulaymān", arabic="سليمان",
         short="The prophet-king to whom the Book of Psalms and dominion were given.",
         detail="'And to Solomon We gave judgment and sound understanding' (38:20). He is praised for the wind, the jinn, and the ants.",
         category=PEOPLE, refs=["38:20", "27:30"]),
    dict(term="Job", variants=["job", "ayyub"], translit="Ayyūb", arabic="أيوب",
         short="The prophet whose long affliction was turned to ease by his endurance.",
         detail="'And remember Ayyub when he cried to his Lord: I have been harmed and You are the Most Merciful' (21:83).",
         category=PEOPLE, refs=["21:83", "38:41"]),
    dict(term="Jesus", variants=["jesus", "isa", "jesus son of maryam"], translit="ʿĪsā", arabic="عيسى",
         short="The prophet, servant and messenger of Mary, called the Word and a Spirit from Him.",
         detail="'The Word and a Spirit from Him' (4:171). Qur'anic accounts of him centre on the virgin birth and the crucifixion - which the Qur'an does not affirm as death.",
         category=PEOPLE, refs=["4:171", "5:75"]),
    dict(term="Joseph", variants=["joseph", "yusuf"], translit="Yūsuf", arabic="يوسف",
         short="The prophet whose story of patience and interpreting dreams fills Surah Yusuf.",
         detail="'The most truthful of dream interpreters' (12:36). The surah is named for him.",
         category=PEOPLE, refs=["12:36", "12:108"]),
    dict(term="Jacob", variants=["jacob", "yakuub"], translit="Yaʿqūb", arabic="يعقوب",
         short="The prophet-father of Joseph, Israel, and his twelve sons.",
         detail="'A man of firm resolve and clear sight' (12:68). Twelve tribes descend from his twelve sons.",
         category=PEOPLE, refs=["12:68", "2:136"]),
    dict(term="Lot", variants=["Lot", "Lut"], translit="Lūṭ", arabic="لوط",
         short="The prophet sent to the people of Sodom.",
         detail="He is praised for rescuing his family and for saying 'I seek refuge in the Mighty One' (26:169). Matched case-sensitively, since 'Lot' is also an ordinary English word and only the capitalised name here is the prophet.",
         case_sensitive=True,
         category=PEOPLE, refs=["26:169", "7:179"]),
    dict(term="Joshua", variants=["joshua", "yusha"], translit="Yūshāʾ", arabic="يوشع",
         short="The prophet after Moses, who brought the Children of Israel into the land.",
         detail="In the Qur'an he is named together with Caleb (al-Ma'sada, 5:22).",
         category=PEOPLE, refs=["5:22", "5:24"]),
    dict(term="Moses's people", variants=["children of israel", "bani israil", "israel"], translit="Banī Isrāʾīl", arabic="بني إسرائيل",
         short="Descendants of Jacob, given scripture and favoured as a chosen people.",
         detail="Their story with the covenant, the golden calf, and the exile is a running theme in the Qur'an.",
         category=PEOPLE, refs=["2:121", "5:77"]),
    dict(term="Mary", variants=["maryam", "mary", "imran"], translit="Maryam", arabic="مريم",
         short="The mother of Jesus, praised for her chastity and her mother of the Book.",
         detail="'Mary, the mother of Jesus, said: The Lord has chosen you over the people of the world and purified you' (3:44).",
         category=PEOPLE, refs=["3:44", "5:75"]),
    dict(term="Anne", variants=["anne", "hannah", "anne moses"], translit="Ānnā", arabic="آمنة",
         short="The mother of Mary, who dedicated her unborn child to the Lord.",
         detail="'My Lord, I have vowed to the One in the womb what is in my right hand, so accept from me' (3:35) - Anne's vow of Mary. The English translation does not name her, so this entry is for reference when reading tafsir.",
         category=PEOPLE, refs=["3:35", "3:29"]),
    dict(term="Pharaoh", variants=["pharaoh", "fir'awn"], translit="Firʿawn", arabic="فرعون",
         short="The tyrant of Egypt who opposed Moses and claimed divinity.",
         detail="'Fir'awn said: I am your lord, most high' (28:23). His name is also the name of the Nile.",
         category=PEOPLE, refs=["28:23", "44:17"]),
    dict(term="Torah", variants=["torah", "tawrat"], translit="Tawrāh", arabic="توراة",
         short="The scripture revealed to Moses.",
         detail="'We gave Moses the scripture (tawrah) saying: You are a messenger' (20:113-114).",
         category=TERMS, refs=["20:114", "5:44"]),
    dict(term="Zabur", variants=["zabur", "psalm", "psalms"], translit="Zabūr", arabic="زبور",
         short="The Psalms, revealed to David.",
         detail="'And to David We gave the Zabur' (4:163) - the only other prophet named as receiving a book in that verse.",
         category=TERMS, refs=["4:163", "21:105"]),
    dict(term="Gospel", variants=["gospel", "injil"], translit="Injīl", arabic="إنجيل",
         short="The scripture revealed to Jesus.",
         detail="'And We gave Jesus, son of Mary, the Injil, containing guidance and light' (5:46).",
         category=TERMS, refs=["5:46", "5:47"]),
    dict(term="Furqan", variants=["furqan", "criterion", "the criterion"], translit="Furqān", arabic="فرقان",
         short="The criterion that distinguishes right from wrong.",
         detail="'Blessed is He who sent down the Criterion (furqan) upon His servant' (25:1) - a name for the Qur'an.",
         category=TERMS, refs=["25:1", "17:16"]),
    dict(term="Quran", variants=["quran", "qur'an"], translit="Qur'ān", arabic="قرآن",
         short="The scripture revealed to the Prophet Muhammad.",
         detail="From qara'a, 'to recite aloud'. Called the Criterion, the Reminder, the Light, and 'the Speech of the Merciful' (55:10).",
         category=TERMS, refs=["2:87", "17:88"]),
    dict(term="Holy Spirit", variants=["holy spirit", "spirit of holiness"], translit="Rūḥ al-Qudus", arabic="روح القدس",
         short="The Spirit sent to Jesus and to the Apostles.",
         detail="Named as the Spirit of the Truth (2:102) and the Holy Spirit (5:104).",
         category=TERMS, refs=["2:102", "5:104"]),
    dict(term="Script and handwriting", variants=["handwriting", "written record"], translit="Kitāb", arabic="كتاب",
         short="A written record; also 'book' for a destined decree.",
         detail="kitab means 'a written thing' and by extension 'a book' and 'a decree' - as in the unaltered 'Book' (kitab) of the beginning (6:59).",
         category=TERMS, refs=["6:59", "2:78"]),
    dict(term="Verse", variants=["verse", "verses", "ayat"], translit="Āyah", arabic="آية",
         short="A verse of the Qur'an; also a sign of God.",
         detail="The root means 'to pass, to come'. Every verse of the Qur'an is itself a sign, which is why the same word carries both senses.",
         category=TERMS, refs=["2:255", "2:256"]),
    dict(term="Night", variants=["layl", "night", "nights"], translit="Layl", arabic="ليل",
         short="Night; paired with the day as one of the paired things the Prophet swore by.",
         detail="'By the night when it covers' (79:1) - layl is paired with the day in Surah al-Layl (91), and night is one of the created signs (2:164).",
         category=COSMOS, refs=["91:1", "79:1"]),
    dict(term="Dawn", variants=["dawn", "daybreak", "morning", "fajr"], translit="Fajr", arabic="فجر",
         short="Root f-j-r: to scatter, to burst out. The break of day.",
         detail="The pre-dawn prayer, Fajr, takes its name from the same root; and at dawn one asks forgiveness (3:17).",
         category=PRACTICE, refs=["2:177", "3:17"]),
    dict(term="The Messenger", variants=["the messenger", "messenger of allah"], translit="Rasūl Allāh", arabic="رسول الله",
         short="The title of the Prophet Muhammad, the final messenger.",
         detail="Brought not a new law but a confirmation ('confirming what was before it') of the earlier scriptures (2:89; 46:35).",
         category=PEOPLE, refs=["2:89", "46:35"]),
    dict(term="Straight path", variants=["straight path", "straight ways"], translit="Ṣirāṭ", arabic="صراط",
         short="Root ṣ-r-ṭ: to be firm, to be straightforward. A clear way.",
         detail="'Guide us to the straight path - the path of those You have blessed' (1:7-9). Qur'anic Sura Fatihah asks for it, so it is one of the most repeated Qur'anic terms.",
         category=TERMS, refs=["1:7", "6:16"]),
    dict(term="Falsehood", variants=["falsehood", "false", "lying", "lies", "lies"], translit="Kadhib", arabic="كذب",
         short="Root k-dh-b: to lie, to refute. Untruth.",
         detail="'They gave a short discount (kadhib) in the world of the Hereafter' (3:90) - the word is used of commerce.",
         category=TERMS, refs=["3:90", "2:11"]),
    dict(term="Hearts", variants=["hearts", "heart"], translit="Qalb", arabic="قلب",
         short="Root q-l-b: to turn. The seat of understanding and intention.",
         detail="Because the root means 'to turn', the Qur'an speaks of hearts that 'turn' - sealed, hardened, diseased, or made whole (2:10; 26:9).",
         category=TERMS, refs=["2:10", "26:9"]),
    dict(term="Bosom", variants=["bosom", "breast", "chest", "bosoms"], translit="Ṣadr", arabic="صدر",
         short="Root ṣ-d-r: to expand, to open. The chest, and the heart within it.",
         detail="'Whoever has expanded for him his chest in Islam' (39:53) - the Qur'an speaks of the heart being opened to guidance.",
         category=TERMS, refs=["39:53", "2:5"]),
    dict(term="Vision", variants=["vision", "visions"], translit="Ru'yah", arabic="رؤيا",
         short="A dream or vision seen by a prophet.",
         detail="Distinguished from the 'dream of the ordinary' - Joseph distinguishes his dream (12:5); and the Prophet's Great Vision is al-Isra (17:1).",
         category=TERMS, refs=["12:5", "17:1"]),
    dict(term="Dream", variants=["dream", "dreams"], translit="Manām", arabic="منام",
         short="A dream during sleep.",
         detail="Distinguished from the 'daydream' of the heart and from the truthful 'vision' of a prophet.",
         category=TERMS, refs=["2:102", "12:100"]),
    dict(term="Arrogance", variants=["arrogance", "arrogant", "arrogant", "pride"], translit="Istakbar", arabic="استكبار",
         short="Root s-k-b-r: to be great, to swell. Pride that resists truth.",
         detail="Qar'un (Korah) is its archetype, destroyed 'because he was one of those who were arrogant' (28:42).",
         category=VIRTUE, refs=["28:42", "31:21"]),
    dict(term="Seal and signet", variants=["signet ring", "sealing", "sealed"], translit="Khātam", arabic="خاتم",
         short="A seal or signet; the Prophet is called 'a ring and a seal that concludes' (33:21).",
         detail="Used of hearts sealed against the truth (2:7) and of the Prophet as 'a ring and a seal', whose seal is the Qur'an. The ordinary English noun 'ring' is deliberately not highlighted, because it appears too often in unrelated senses to be a reliable marker.",
         category=PEOPLE, refs=["33:21", "2:7"]),
    dict(term="Inheritance", variants=["heirs", "heir", "inheritance", "inheritors", "inherited"], translit="Mīrāth", arabic="ميراث",
         short="Root m-w-r-th: to succeed, to inherit. The estate of the deceased.",
         detail="'And from what is left to the heirs' (4:11) - used in the extensive laws of inheritance (4:7-12).",
         category=PRACTICE, refs=["4:11", "4:7"]),
    dict(term="Scholar", variants=["scholar", "scholars", "learned", "ulema"], translit="'Ālim", arabic="عالم",
         short="Root '-l-m: to know. One who knows.",
         detail="Knows in the passive, 'he was taught'; and active, 'he is a scholar of the people of the Book' (3:39).",
         category=PEOPLE, refs=["3:39", "9:14"]),
]


def _build_matcher(entry: Dict):
    """Compile a word-boundary alternation of an entry's variants.

    Entries marked `case_sensitive` match with exact casing. That matters
    for names that double as ordinary English words: in the translation
    "Lot" is always the prophet, while a lowercase "lot" is a share - so
    matching both loosely would highlight the prophet inside "a lot of".
    """
    variants = sorted(set(entry["variants"]), key=len, reverse=True)
    if not variants:
        return None
    # \b boundaries only work for ASCII-word chars at the edges. All our
    # variants are ASCII, so this is safe and avoids matching inside a
    # longer word.
    pattern = r"\b(?:" + "|".join(re.escape(v) for v in variants) + r")\b"
    flags = 0 if entry.get("case_sensitive") else re.IGNORECASE
    return re.compile(pattern, flags)


class Glossary:
    """Look up and annotate Quranic terms in translated text."""

    def __init__(self, entries: Optional[List[Dict]] = None):
        self.entries = entries if entries is not None else ENTRIES
        self._by_term: Dict[str, Dict] = {}
        self._matchers: List = []
        self.duplicate_terms: List[str] = []
        for entry in self.entries:
            key = entry["term"].lower()
            if key in self._by_term:
                # Keep the first definition and report the clash rather than
                # silently letting a later entry shadow it.
                self.duplicate_terms.append(entry["term"])
                continue
            self._by_term[key] = entry
            matcher = _build_matcher(entry)
            if matcher:
                self._matchers.append((matcher, entry))
        self._categories = sorted({e["category"] for e in self.entries})

    # -- lookup ---------------------------------------------------------

    def get(self, term: str) -> Optional[Dict]:
        return self._by_term.get((term or "").strip().lower())

    @property
    def categories(self) -> List[str]:
        return self._categories

    def search(self, query: str = "") -> List[Dict]:
        """Filter entries by term, transliteration, or definition text."""
        q = (query or "").strip().lower()
        if not q:
            return list(self.entries)
        out = []
        for entry in self.entries:
            haystack = " ".join([
                entry["term"],
                entry.get("translit", ""),
                " ".join(entry.get("variants", [])),
                entry.get("short", ""),
                entry.get("category", ""),
            ]).lower()
            if q in haystack:
                out.append(entry)
        return out

    def public_entries(self) -> List[Dict]:
        """Entries in a shape safe to hand to the browser."""
        return [{
            "term": e["term"],
            "variants": e.get("variants", []),
            "translit": e.get("translit", ""),
            "arabic": e.get("arabic", ""),
            "short": e.get("short", ""),
            "detail": e.get("detail", ""),
            "category": e.get("category", ""),
            "refs": e.get("refs", []),
        } for e in self.entries]

    # -- annotation -----------------------------------------------------

    def find_terms(self, text: str) -> List[Dict]:
        """Return the glossary terms present in a piece of text."""
        if not text:
            return []
        found: Dict[str, Dict] = {}
        for matcher, entry in self._matchers:
            if matcher.search(text):
                found[entry["term"]] = {
                    "term": entry["term"],
                    "short": entry["short"],
                    "translit": entry.get("translit", ""),
                    "category": entry.get("category", ""),
                }
        return list(found.values())

    def annotate(self, text: str) -> str:
        """Wrap glossary terms in <g-term> tags for the reading view.

        Longest variants are applied first so a multi-word phrase is never
        broken up by a shorter term nested inside it.
        """
        if not text:
            return ""
        spans = []
        for matcher, entry in self._matchers:
            for m in matcher.finditer(text):
                if m.group(0).strip():
                    spans.append((m.start(), m.end(), entry["term"]))
        if not spans:
            return text

        # Drop overlaps, preferring the longest match at each position.
        spans.sort(key=lambda s: (s[0], -(s[1] - s[0])))
        chosen: List = []
        last_end = -1
        for start, end, term in spans:
            if start >= last_end:
                chosen.append((start, end, term))
                last_end = end

        out = []
        cursor = 0
        for start, end, term in chosen:
            out.append(text[cursor:start])
            out.append(f'<g-term data-term="{term}">{text[start:end]}</g-term>')
            cursor = end
        out.append(text[cursor:])
        return "".join(out)


GLOSSARY = Glossary()


def validate_glossary(verses) -> Dict:
    """Check the glossary against the real corpus.

    Reports any entry whose variants never appear, and any referenced verse
    that does not exist. Used as a self-test, not at runtime.
    """
    import collections

    df = collections.Counter()
    keys = set()
    for v in verses:
        keys.add(v.verse_key)
        text = v.translation or ""
        for matcher, entry in GLOSSARY._matchers:
            if matcher.search(text):
                df[entry["term"]] += 1

    missing = sorted(e["term"] for e in GLOSSARY.entries if df[e["term"]] == 0)
    bad_refs = []
    for e in GLOSSARY.entries:
        for ref in e.get("refs", []):
            if ref not in keys:
                bad_refs.append((e["term"], ref))

    total = len(verses)
    matched = sum(
        1 for v in verses
        if any(m.search(v.translation or "") for m, _ in GLOSSARY._matchers)
    )

    return {
        "entries": len(GLOSSARY.entries),
        "duplicate_terms": GLOSSARY.duplicate_terms,
        "unused_entries": missing,
        "bad_refs": bad_refs,
        "verses_with_terms": matched,
        "coverage_pct": round(100.0 * matched / total, 1) if total else 0.0,
        "top_by_frequency": df.most_common(15),
    }


if __name__ == "__main__":
    # Self-test: python glossary.py
    from data_service import DataService

    report = validate_glossary(DataService()._get_full_quran("en"))
    print(f"entries:            {report['entries']}")
    print(f"duplicate terms:    {report['duplicate_terms'] or 'none'}")
    print(f"verse coverage:     {report['coverage_pct']}% of verses contain a term")
    if report["bad_refs"]:
        print(f"BAD REFS:           {report['bad_refs']}")
    else:
        print("bad refs:           none")
    if report["unused_entries"]:
        print("\nreference-only entries (never auto-detected in en.sahih):")
        for term in report["unused_entries"]:
            print(f"  - {term}")
    print("\nmost frequent terms:")
    for term, count in report["top_by_frequency"]:
        print(f"  {count:5d}  {term}")
