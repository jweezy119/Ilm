/**
 * A Greek stemmer, transcribed from the Snowball source.
 *
 * Ntais 2006 with the Saroukos 2008 additions, from
 * snowballstem.org/algorithms/greek/stemmer.html. The `.sbl` and the published
 * listing of that algorithm are byte-identical, so this is a transcription of the
 * canonical version rather than of a summary of it.
 *
 * It exists for the New Testament, which is the one corpus where the original-text
 * index stores exact surface forms and Greek inflects every noun by case, number
 * and gender. θεός, θεοῦ, θεῷ, θεοί and θεῶν are five unrelated lexemes for one
 * word, so a reader who types one does not find the other four.
 *
 * No Greek stemmer is available to import. The `snowball-stemmers` package carries
 * 24 languages and Greek is not one of them — and that is worth stating carefully,
 * because `algorithms('greek')` returns an *empty array*, which is truthy in
 * JavaScript, so a naive availability check reports Greek as supported. `natural`
 * has only English, Russian and Spanish, and `wstemmer` is not in the registry.
 * `PyStemmer` does wrap a Greek implementation, but it is a different build: it
 * disagrees with the canonical algorithm on 57% of the corpus's tokens and has an
 * `-ος` rule the canonical one has nowhere. It was useful for finding that
 * disagreement and useless as ground truth.
 *
 * The one number worth remembering from validating this: the published `tolower`
 * covers *monotonic* accents, and the New Testament is polytonic. τὸν, αὐτὸν and
 * Ἰησοῦν pass through it unchanged, and since every suffix rule compares against
 * unaccented Greek, an accented word matches nothing at all. Applied as written the
 * algorithm is very nearly a no-op on this corpus.
 */

/** v in the spec: α ε η ι ο υ ω. */
const VOWELS = 'αεηιουω';
/** v2 in the spec: v without upsilon. */
const VOWELS_NO_U = 'αεηιοω';

// Static rule tables hoisted to module scope so `stemGreek` allocates zero
// suffix/prefix arrays per token.
const STEP_1_RULES: ReadonlyArray<readonly [readonly string[], string]> = [
  [['φαγια', 'φαγου', 'φαγων'], 'φα'],
  [['σκαγια', 'σκαγου', 'σκαγων'], 'σκα'],
  [['ολογου', 'ολογα', 'ολογων'], 'ολο'],
  [['σογου', 'σογα', 'σογων'], 'σο'],
  [['τατογια', 'τατογου', 'τατογων'], 'τατο'],
  [['κρεας', 'κρεατος', 'κρεατα', 'κρεατων'], 'κρεα'],
  [['περας', 'περατος', 'περατι', 'περατα', 'περατων'], 'περα'],
  [['τερας', 'τερατος', 'τερατα', 'τερατων'], 'τερα'],
  [['φος', 'φοτος', 'φοτα', 'φοτων'], 'φο'],
  [['καθεστοος', 'καθεστοτοσ', 'καθεστοτοα', 'καθεστοτον'], 'καθεστο'],
  [['γεγονος', 'γεγονοτοσ', 'γεγονοτα', 'γεγονοτων'], 'γεγονο'],
];

const STEP_S1_END = ['ζα', 'ζες', 'ζε', 'ζαμε', 'ζατε', 'ζαν', 'ζανε', 'ζω', 'ζεις', 'ζει', 'ζουμε', 'ζετε', 'ζουν', 'ζουνε'];
const STEP_S1_PREF_I = ['αναμπα', 'εμπα', 'επα', 'χαναπα', 'πα', 'περιπα', 'αθρο', 'συναθρο', 'δανε'];
const STEP_S1_PREF_YS = ['μαρκ', 'κορν', 'αμπαρ', 'αρρ', 'βαθυρυ', 'βαρκ', 'β', 'βολβορ', 'γλυκορ', 'γλυκυρ', 'γμπ', 'λ', 'λου', 'μαρ', 'μ', 'πρ', 'μπρ', 'πολυρ', 'π', 'ρ', 'πυπερορ'];

const STEP_S2_END = ['ουθικα', 'ουθικες', 'ουθικε', 'ουθικαμε', 'ουθικατε', 'ουθικαν', 'ουθικανε'];
const STEP_S2_PREF = ['αλ', 'βγ', 'εν', 'υπσ', 'λγ', 'ζοο', 'σ', 'χ'];

const STEP_S3_START = ['γσα'];
const STEP_S3_END = ['γσα', 'γσες', 'γσε', 'γσαμε', 'γσατε', 'γσαν', 'γσανε'];
const STEP_S3_PREF_I = ['αναμπα', 'αθρο', 'εμπα', 'εσε', 'εσοοκλε', 'επα', 'χαναπα', 'επε', 'περιπα', 'συναθρο', 'δανε', 'κλε', 'χαρτοπα', 'εξαρχ', 'μετεπε', 'αποκλε', 'απεκλε', 'εκλε', 'πε'];
const STEP_S3_PREF_GS = ['αν', 'αφ', 'γε', 'γυγαντοαφ', 'γκε', 'διμοκρατ', 'κομ', 'γκ', 'μ', 'π', 'πουκαμ', 'ολο', 'λαρ'];

const STEP_S4_END = ['γσο', 'γσευς', 'γσευ', 'γσουμε', 'γσετε', 'γσουν', 'γσουνε'];
const STEP_S4_PREF = ['αναμπα', 'εμπα', 'εσε', 'εσοοκλε', 'επα', 'χαναπα', 'επε', 'περιπα', 'συναθρο', 'δανε', 'κλε', 'χαρτοπα', 'εξαρχ', 'μετεπε', 'αποκλε', 'απεκλε', 'εκλε', 'πε'];

const STEP_S5_END = ['γστος', 'γστου', 'γστο', 'γστε', 'γστογ', 'γστοον', 'γστους', 'γστι', 'γστις', 'γστα', 'γστες'];
const STEP_S5_PREF_I = ['δανε', 'συναθρο', 'κλε', 'σε', 'εσοοκλε', 'ασε', 'πλε'];
const STEP_S5_PREF_GST = ['μ', 'π', 'απ', 'αρ', 'ιδ', 'κτ', 'σκ', 'σχ', 'υπσ', 'φα', 'χρ', 'χτ', 'ακτ', 'αορ', 'ασχ', 'ατα', 'αχν', 'αχτ', 'γεμ', 'γυρ', 'εμπ', 'ευρ', 'εχθ', 'ιφα', 'καθ', 'κακ', 'κυλ', 'λυγ', 'μακ', 'μεγ', 'ταχ', 'φυλ', 'χουρ'];

const STEP_S6_END = ['γσμο', 'γσμογ', 'γσμος', 'γσμου', 'γσμους', 'γσμοον'];
const STEP_S6_PREF_GSM = ['σε', 'μετασε', 'μυκροσε', 'εγκλε', 'αποκλε'];
const STEP_S6_PREF_G = ['δανε', 'αντυδανε'];
const STEP_S6_RULES: ReadonlyArray<readonly [readonly string[], string]> = [
  [['αγνωστικ'], 'αγνοστ'],
  [['ατομικ'], 'ατομ'],
  [['γνωστικ'], 'γνοστ'],
  [['εθνικ'], 'εθν'],
  [['εκλεκτικ'], 'εκλεκ'],
  [['σκεπτικ'], 'σκεπτ'],
  [['τοπικ'], 'τοπ'],
  [['αλεξανδρειν'], 'αλεξανδρ'],
  [['βουζαντειν'], 'βουζαντ'],
  [['θεατρειν'], 'θεατρ'],
];

const STEP_S7_END = ['αρακι', 'αρακια', 'ουδακι', 'ουδακια'];
const STEP_S7_PREF = ['σ', 'χ'];

const STEP_S8_END = ['ακι', 'ακια', 'υτσα', 'υτσας', 'υτσες', 'υτσων', 'αρακι', 'αρακια'];
const STEP_S8_PREF_AK = [
  'βαμβ', 'βρ', 'καγμ', 'κορ', 'κοσμ', 'λαβρ', 'λουλ', 'μερ', 'μουστ', 'ναγκασ', 'πλ', 'ρ', 'ρυ',
  'σ', 'σκ', 'σοκ', 'σπαν', 'τζ', 'φαρμ', 'χ', 'καπακ', 'αλυσφ', 'αμβρ', 'ανθρ', 'κ', 'φυλ',
  'κατραπ', 'κλυμ', 'μαλ', 'σλοβ', 'φ', 'σφ', 'τσεχοσλοβ',
];
const STEP_S8_PREF_YTS = [
  'β', 'βαλ', 'γιαν', 'γλ', 'ζ', 'ιγουμεν', 'καρδ', 'μακρυν', 'νυφ', 'πατερ', 'π', 'τοσ', 'τρυπολ',
];
const STEP_S8_START_KOR = ['κορ'];

const STEP_S9_END = ['γδυο', 'γδυα', 'γδυων'];
const STEP_S9_PREF = ['αυγν', 'γρ', 'ολο', 'ψαλ'];
const STEP_S9_ANY = ['ε', 'παγχν'];

const STEP_S10_END = ['γσκοσ', 'γσκου', 'γσκο', 'γσκε'];
const STEP_S10_PREF = ['δ', 'γν', 'μιν', 'ρ', 'φραγκ', 'λυκ', 'οβελ'];

const STEP_2A_END = ['αδες', 'αδον'];
const STEP_2A_EXCEPT = ['οκ', 'μαμ', 'μαν', 'μπαμπ', 'πατερ', 'γιαγι', 'νταντ', 'κυρ', 'θε', 'πεθε'];
const STEP_2B_END = ['εδες', 'εδον'];
const STEP_2B_ANY = ['οπ', 'υπ', 'εμπ', 'γιπ', 'δαπ', 'κρασπ', 'μυλ'];
const STEP_2C_END = ['ουδες', 'ουδον'];
const STEP_2C_ANY = [
  'αρκ', 'καλιακ', 'πεταλ', 'λυχ', 'πλεξ', 'σκ', 'σ', 'φλ', 'φρ', 'βελ', 'λουλ', 'χν', 'σπ', 'τραγ', 'φε',
];
const STEP_2D_END = ['εος', 'εον'];
const STEP_2D_PREF = ['θ', 'δ', 'ελ', 'γαλ', 'ν', 'π', 'υδ', 'παρ'];

const STEP_3_END = ['ια', 'ιου', 'ιων'];
const STEP_4_END = ['ικα', 'ικο', 'ικου', 'ικων'];
const STEP_4_PREF = [
  'αλ', 'αδ', 'ενδ', 'αμαν', 'αμμοχαλ', 'ιθ', 'ανιθ', 'αντυδ', 'φυσ', 'βρομ', 'γερ',
  'εξοοδ', 'καλπ', 'καλλυν', 'καταδ', 'μουλ', 'μπαν', 'μπαγιατ', 'μπολ', 'μποσ', 'νυτ', 'χυκ',
  'συνομιλ', 'πετσ', 'πυτσ', 'πυκαντ', 'πλγιατσ', 'ποστελεν', 'προτοδ', 'σερτ', 'συναδ', 'τσαμ', 'υποδ',
  'φυλον', 'φυλοδ', 'χασ',
];

const STEP_5A_END = ['αγαμε', 'ισαμε', 'ουσαμε', 'ικαμε', 'ιθικαμε'];
const STEP_5A_PREF = ['αναπ', 'αποθ', 'αποκ', 'αποστ', 'βουν', 'χεθ', 'ουλ', 'πεθ', 'πυκρ', 'ποτ', 'συχ', 'χ'];

const STEP_5B_END = [
  'αγανε', 'ισανε', 'ουσανε', 'γοντανε', 'γοτανε', 'γουντανε', 'οντανε', 'οτανε',
  'ουντανε', 'ικανε', 'ιθικανε',
];
const STEP_5B_PREF_AGAN = ['τρ', 'τσ'];
const STEP_5B_PREF_AN = [
  'βετερ', 'βουλκ', 'βραχμ', 'γ', 'δραδουμ', 'θ', 'καλπουζ', 'καστελ', 'κορμορ',
  'λαοπλ', 'μοαμεθ', 'μ', 'μουσουλμ', 'ν', 'ουλ', 'π', 'πελλεκ', 'πλ', 'πολυσ',
  'πορτολ', 'σαρακατσ', 'σουλτ', 'τσαρλατ', 'ορφ', 'τσυγγ', 'τσοπ', 'φοτοστεφ',
  'χ', 'ψυχοπλ', 'αγ', 'γαλ', 'γερ', 'δεκ', 'δυπλ', 'αμερικα', 'ουρ', 'πυθ', 'πουρυτ',
  'σ', 'ζοντ', 'γκ', 'καστ', 'κοπ', 'λυχ', 'λουθιρ', 'μαγντ', 'μελ', 'συγ', 'σπ',
  'στεγ', 'τραγ', 'τσαγ', 'φ', 'ερ', 'αδαπ', 'αθυγγ', 'αμιχ', 'ανγκ', 'ανοργ',
  'απιγ', 'απυθ', 'ατσυγγ', 'βας', 'βασκ', 'βιαμ', 'βρομ', 'δια', 'διαφ', 'ενοργ',
  'θυσ', 'καπνο', 'καταγαλ', 'κλυβ', 'κογλατς', 'κολ', 'κρη', 'κτησ', 'κυρ',
  'κωλ', 'λαν', 'λεγκ', 'λεκ', 'λοουθιρ', 'μεγαλο', 'μεγλοβ', 'μορ', 'μποροβ',
  'μυκρο', 'νταβ', 'ξιροκλυβ', 'ολογοδαμ', 'ολογαλ', 'πενταρ', 'περιφ', 'περιστ',
  'πλατ', 'πολυδαπ', 'πολυμιχ', 'στεφ', 'ταβ', 'τετ', 'υπεριφ', 'υποκο', 'χαμιλοδ',
  'ψαλ', 'αδ', 'επιτροπε', 'ετο', 'μου', 'μπα', 'γιν', 'ποστελεν', 'θρον', 'αλ', 'αρτι',
  'εσο', 'ετο', 'κομμ', 'μπου', 'τσομβ', 'ακου', 'ακρι', 'αμ', 'αναθ', 'αντι', 'δια',
  'εκ', 'εκαστ', 'εξω', 'επι', 'καθ', 'κακο', 'καλο', 'κλπ', 'μολ', 'μπα', 'πα',
  'πλ', 'σο', 'συ', 'συν', 'συνεχ', 'συνε', 'υπο', 'υποκ', 'χαριν', 'ωρα', 'ωσ', 'ορ',
];

const STEP_5C_ANY = ['οδ', 'αυρ', 'φορ', 'ταθ', 'διαθ', 'σχ', 'ενδ', 'ευρ', 'τυθ', 'υπερθ', 'ραθ', 'ενθ', 'ροθ', 'σθ', 'πυρ', 'αυν', 'συνδ', 'συν', 'συνθ', 'χουρ', 'πον', 'υρ', 'καθ', 'ευθ', 'εκθ', 'νετ', 'ρον', 'αρκ', 'βαρ', 'βολ', 'ουφελ'];
const STEP_5C_PREF = ['αβαρ', 'βεν', 'εναρ', 'αβρ', 'αδ', 'αθ', 'αν', 'απλ', 'βαρον', 'ντρ', 'σκ', 'κοπ', 'μπορ', 'νυφ', 'παγ', 'παρακαλ', 'σερπ', 'σκελ', 'συρφ', 'τοκ', 'υ', 'δ', 'εμ', 'θαρρ', 'θ'];

const STEP_5D_END = ['οντας', 'ωντας'];
const STEP_5E_END = ['ομαστε', 'γομαστε'];
const STEP_5F_PREF_GES = ['π', 'απ', 'συμπ', 'ασυμπ', 'ακαταπ', 'αμεταμφ'];
const STEP_5F_PREF_GEST = ['αλ', 'αρ', 'εκτελ', 'ζ', 'μ', 'χ', 'παρακαλ', 'προ', 'νυς'];

const STEP_5G_END_1 = ['ιθικα', 'ιθικες', 'ιθικε'];
const STEP_5G_END_2 = ['ικα', 'ικες', 'ικε'];
const STEP_5G_PREF_1 = ['σκοολ', 'σκουλ', 'ναρθ', 'σφ', 'οθ', 'πυθ'];
const STEP_5G_PREF_2 = ['δυαθ', 'θ', 'παρακαταθ', 'προσθ', 'συνθ'];

const STEP_5H_END = ['ουσα', 'ουσες', 'ουσε'];
const STEP_5H_PREF_1 = ['ποδαρ', 'βλεπ', 'πανταχ', 'φρυδ', 'ματσυλ', 'μαλλ', 'κυματ', 'λαχ', 'λιγ', 'φαγ', 'ομ', 'προοτ'];
const STEP_5H_PREF_2 = ['φαρμακ', 'χαδ', 'αγκ', 'αναρρ', 'βρομ', 'εκλυπ', 'λαμπυδ', 'λεχ', 'μ', 'πατ', 'ρ', 'λ', 'μεδ', 'μεσαζ', 'υποτειν', 'αμ', 'αυθ', 'ανι', 'δεσποζ', 'ενδυαφερ', 'δε', 'δευτερειν', 'καθαρευ', 'πλε', 'τσα'];

const STEP_5I_END = ['αγα', 'αγες', 'αγε'];
const STEP_5I_ANY_1 = ['ψοφ', 'ναυλοχ'];
const STEP_5I_ANY_2 = ['οφ', 'πελ', 'χορτ', 'λλ', 'σφ', 'ρπ', 'φρ', 'πρ', 'λοχ', 'σμιν'];
const STEP_5I_PREF = [
  'αβαστ', 'πολυφ', 'αδιφ', 'παμφ', 'ρ', 'ασπ', 'αφ', 'αμαλ', 'αμαλλυ', 'ανυστ', 'απερ',
  'ασπαρ', 'αχαρ', 'δερβεν', 'δροσοπ', 'χεφ', 'νεοπ', 'νομοτ', 'ολοπ', 'ομοτ', 'προστ',
  'προσοποπ', 'συμπ', 'συντ', 'τ', 'υποτ', 'χαρ', 'αεγ', 'αγμοστ', 'ανυπ', 'αποτ', 'αρτυπ',
  'δυατ', 'εν', 'επυτ', 'κροκαλοπ', 'συδιροπ', 'λ', 'ναυ', 'ουλαμ', 'ουρ', 'π', 'τρ', 'μ',
];

const STEP_5J_END = ['ισε', 'ισου', 'ισα'];
const STEP_5J_PREF = ['ν', 'χερσον', 'δουδεκαν', 'εριμον', 'μεγαλον', 'επταν'];

const STEP_5K_PREF = ['ασυ', 'συ', 'αχρ', 'χρ', 'απλ', 'αειμν', 'δυσχρ', 'ευχρ', 'κογνοχρ', 'παλυμψ'];

const STEP_5L_END = ['ουνε', 'ισουνε', 'ιθουνε'];
const STEP_5L_PREF = ['ν', 'ρ', 'σπυ', 'στρατουτσ', 'κακομουτσ', 'εξουν'];

const STEP_5M_END = ['ουμε', 'ισουμε', 'ιθουμε'];
const STEP_5M_PREF = ['παρασουσ', 'φ', 'χ', 'ουριοπλ', 'αζ', 'αλλοσουσ', 'ασουσ'];

const STEP_6_MAT = ['ματα', 'ματον', 'ματος'];
const STEP_6_END = [
  'α', 'αγατε', 'αγαν', 'αει', 'αμαι', 'αν', 'ας', 'ασαι', 'αται', 'αο', 'ε', 'ει',
  'εις', 'ειτε', 'εσαι', 'ες', 'εται', 'ι', 'ιεμαι', 'ιεμαστε', 'ιεται', 'ιεσαι',
  'ιομοσταν', 'ιομουν', 'ιομουνα', 'ιονταν', 'ιοντουσαν', 'ιοσασταν', 'ιοσαστε', 'ιοσουν',
  'ιοσουνα', 'ιοταν', 'ιουμαι', 'ιουμαστε', 'ιουνταν', 'ιουντανται', 'ισ', 'ισαν',
  'ισατε', 'ισει', 'ισεις', 'ισεσουν', 'ισο', 'ισοι', 'ισον', 'ισουν', 'ισουνα', 'ισων',
  'ιταμε', 'ιτε', 'ιτουν', 'ιτουνα', 'ιτων', 'μ', 'μαι', 'μαστε', 'με', 'μεθ', 'μεθετε',
  'μου', 'μουνα', 'ν', 'ντουσαν', 'ο', 'οι', 'ομαι', 'ομασταν', 'ομουν', 'ομουνα', 'ονταν',
  'οντας', 'οντουσαν', 'ος', 'οσασταν', 'οσαστε', 'οσουν', 'οσουνα', 'οταν', 'ου', 'ουμαι',
  'ουμαστε', 'ουν', 'ουνταν', 'ους', 'ουσαν', 'ουσατε', 'ουσε', 'ω', 'ως', 'ων',
];

const STEP_7_END = ['εστερ', 'εστατ', 'οτερ', 'οτατ', 'υτερ', 'υτατ', 'ωτερ', 'ωτατ'];

/**
 * Memoization cache keyed by folded Greek word. The entire Greek New Testament
 * has ~19k unique surface forms repeated across ~138k tokens, so caching cuts
 * indexing stemmer work dramatically.
 */
const STEM_CACHE = new Map<string, string>();
const STEM_CACHE_LIMIT = 50_000;

/** Longest member of `list` that `word` ends with, or null. */
function ending(word: string, list: readonly string[]): string | null {
  let best: string | null = null;
  for (const item of list) {
    if (item.length <= word.length && word.endsWith(item)) {
      if (best === null || item.length > best.length) best = item;
    }
  }
  return best;
}

/** Longest member of `list` that `word` starts with, or null. */
function starting(word: string, list: readonly string[]): string | null {
  let best: string | null = null;
  for (const item of list) {
    if (item.length <= word.length && word.startsWith(item)) {
      if (best === null || item.length > best.length) best = item;
    }
  }
  return best;
}

/**
 * Longest member of `list` occurring anywhere in `word`, leftmost on a tie.
 *
 * The spec writes this as `[] substring among (...) <- (...)`, which is a match
 * anywhere rather than a match at the limit, and the lists are used for both
 * prefixes and suffixes — step_2b needs the suffix in μυλεδες → εδ, step_5c needs
 * the prefix in the ιση/ισε verbs. "Anywhere" is the reading that satisfies both.
 */
function occurring(word: string, list: readonly string[]): [number, string] | null {
  let best: [number, string] | null = null;
  for (const item of list) {
    let from = word.indexOf(item);
    while (from !== -1) {
      if (best === null || item.length > best[1].length || (item.length === best[1].length && from < best[0])) {
        best = [from, item];
      }
      from = word.indexOf(item, from + 1);
    }
  }
  return best;
}

function replacePrefix(word: string, list: readonly string[], repl: string): string | null {
  const hit = starting(word, list);
  return hit === null ? null : repl + word.slice(hit.length);
}

function replaceAnywhere(word: string, list: readonly string[], repl: string): string | null {
  const hit = occurring(word, list);
  return hit === null ? null : word.slice(0, hit[0]) + repl + word.slice(hit[0] + hit[1].length);
}

function replaceVowel(word: string, vowels: string, repl: string): string | null {
  for (let at = 0; at < word.length; at += 1) {
    if (vowels.includes(word[at])) return word.slice(0, at) + repl + word.slice(at + 1);
  }
  return null;
}

/**
 * tolower, and not the one in the spec.
 *
 * The spec's is a hand-written table covering the monotonic accents — ά έ ί ό ύ ώ
 * and their capitals — which is all Modern Greek needs. Decomposing and dropping
 * the combining marks is what that table is reaching for by hand, and it
 * additionally gets ᾳ → α and the polytonic capitals right, which the table does
 * not. It is strictly a superset of the spec's behaviour on monotonic text.
 *
 * The final sigma is folded afterwards because the algorithm compares against σ
 * and JavaScript's toLowerCase applies the final-sigma rule, which would otherwise
 * leave a ς at the end of a word for no suffix to match.
 */
export function foldGreek(word: string): string {
  return word.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/\u03C2/g, '\u03C3');
}

export function stemGreek(input: string): string {
  const folded = foldGreek(input);
  // has_min_length
  if (folded.length < 3) return folded;

  const cached = STEM_CACHE.get(folded);
  if (cached !== undefined) return cached;

  let word = folded;

  /*
   * test1 is set here and unset by any step that changes the word, so step_6 can
   * tell "nothing has been stripped yet" from "something has".
   */
  let test1 = true;
  const touched = () => {
    test1 = false;
  };

  // step_1
  {
    let done = false;
    for (const [list, repl] of STEP_1_RULES) {
      if (done) break;
      if (ending(word, list) !== null) {
        word = replaceAnywhere(word, list, repl) ?? word;
        touched();
        done = true;
      }
    }
  }

  // step_s1
  {
    const hit = ending(word, STEP_S1_END);
    if (hit !== null) {
      word = word.slice(0, -hit.length);
      touched();
      word =
        replacePrefix(word, STEP_S1_PREF_I, 'ι') ??
        replacePrefix(word, STEP_S1_PREF_YS, 'υσ') ??
        word;
    }
  }

  // step_s2
  {
    const hit = ending(word, STEP_S2_END);
    if (hit !== null) {
      word = word.slice(0, -hit.length);
      touched();
      word = replacePrefix(word, STEP_S2_PREF, 'ουν') ?? word;
    }
  }

  // step_s3
  {
    if (starting(word, STEP_S3_START) !== null) {
      word = 'γσ' + word.slice(3);
      touched();
    } else {
      const hit = ending(word, STEP_S3_END);
      if (hit !== null) {
        word = word.slice(0, -hit.length);
        touched();
        word =
          replacePrefix(word, STEP_S3_PREF_I, 'ι') ??
          replacePrefix(word, STEP_S3_PREF_GS, 'γσ') ??
          word;
      }
    }
  }

  // step_s4
  {
    const hit = ending(word, STEP_S4_END);
    if (hit !== null) {
      word = word.slice(0, -hit.length);
      touched();
      word = replacePrefix(word, STEP_S4_PREF, 'ι') ?? word;
    }
  }

  // step_s5
  {
    const hit = ending(word, STEP_S5_END);
    if (hit !== null) {
      word = word.slice(0, -hit.length);
      touched();
      word =
        replacePrefix(word, STEP_S5_PREF_I, 'ι') ??
        replacePrefix(word, STEP_S5_PREF_GST, 'γστ') ??
        word;
    }
  }

  // step_s6
  {
    const hit = ending(word, STEP_S6_END);
    if (hit !== null) {
      word = word.slice(0, -hit.length);
      touched();
      word =
        replacePrefix(word, STEP_S6_PREF_GSM, 'γσμ') ??
        replacePrefix(word, STEP_S6_PREF_G, 'γ') ??
        word;
    } else {
      for (const [list, repl] of STEP_S6_RULES) {
        const before = word;
        word = replaceAnywhere(word, list, repl) ?? word;
        if (word !== before) {
          touched();
          break;
        }
      }
    }
  }

  // step_s7
  {
    const hit = ending(word, STEP_S7_END);
    if (hit !== null) {
      word = word.slice(0, -hit.length);
      touched();
      word = replacePrefix(word, STEP_S7_PREF, 'αρακ') ?? word;
    }
  }

  // step_s8
  {
    const hit = ending(word, STEP_S8_END);
    if (hit !== null) {
      word = word.slice(0, -hit.length);
      touched();
      const asAlpha = replacePrefix(word, STEP_S8_PREF_AK, 'ακ');
      const asYpsilon = replacePrefix(word, STEP_S8_PREF_YTS, 'υτσ');
      word = asAlpha ?? asYpsilon ?? (starting(word, STEP_S8_START_KOR) !== null ? 'υτσ' + word.slice(3) : word);
    }
  }

  // step_s9
  {
    const hit = ending(word, STEP_S9_END);
    if (hit !== null) {
      word = word.slice(0, -hit.length);
      touched();
      word = replacePrefix(word, STEP_S9_PREF, 'γδ') ?? replaceAnywhere(word, STEP_S9_ANY, 'γδ') ?? word;
    }
  }

  // step_s10
  {
    const hit = ending(word, STEP_S10_END);
    if (hit !== null) {
      word = word.slice(0, -hit.length);
      touched();
      word = replacePrefix(word, STEP_S10_PREF, 'γσκ') ?? word;
    }
  }

  // step_2a
  {
    const hit = ending(word, STEP_2A_END);
    if (hit !== null) {
      const rest = word.slice(0, -hit.length);
      if (!STEP_2A_EXCEPT.some((x) => rest.includes(x))) {
        word = rest + 'αδ';
        touched();
      }
    }
  }

  // step_2b
  {
    const hit = ending(word, STEP_2B_END);
    if (hit !== null) {
      const rest = word.slice(0, -hit.length);
      const done = replaceAnywhere(rest, STEP_2B_ANY, 'εδ');
      if (done !== null) {
        word = done;
        touched();
      }
    }
  }

  // step_2c
  {
    const hit = ending(word, STEP_2C_END);
    if (hit !== null) {
      const rest = word.slice(0, -hit.length);
      const done = replaceAnywhere(rest, STEP_2C_ANY, 'ουδ');
      if (done !== null) {
        word = done;
        touched();
      }
    }
  }

  // step_2d
  {
    const hit = ending(word, STEP_2D_END);
    if (hit !== null) {
      const rest = word.slice(0, -hit.length);
      touched();
      word = replacePrefix(rest, STEP_2D_PREF, 'ε') ?? rest;
    }
  }

  // step_3
  {
    const hit = ending(word, STEP_3_END);
    if (hit !== null) {
      word = word.slice(0, -hit.length);
      touched();
      word = replaceVowel(word, VOWELS, 'υ') ?? word;
    }
  }

  // step_4
  {
    const hit = ending(word, STEP_4_END);
    if (hit !== null) {
      word = word.slice(0, -hit.length);
      touched();
      word =
        replaceVowel(word, VOWELS, 'ικ') ??
        replacePrefix(word, STEP_4_PREF, 'ικ') ??
        word;
    }
  }

  // step_5a
  {
    let rest: string | null = null;
    if (word === 'αγαμε') {
      rest = 'αγαμ';
    } else {
      const hit = ending(word, STEP_5A_END);
      if (hit !== null) {
        rest = word.slice(0, -hit.length);
        touched();
      }
    }
    if (rest !== null) {
      if (rest.endsWith('αμε')) {
        rest = rest.slice(0, -3);
        touched();
      }
      word = replacePrefix(rest, STEP_5A_PREF, 'αμ') ?? rest;
    }
  }

  // step_5b
  {
    const hit = ending(word, STEP_5B_END);
    if (hit !== null) {
      const rest = word.slice(0, -hit.length);
      word = replacePrefix(rest, STEP_5B_PREF_AGAN, 'αγαν') ?? rest;
      touched();
    }
    if (word.endsWith('ανε')) {
      let rest = word.slice(0, -3);
      touched();
      rest = replaceVowel(rest, VOWELS_NO_U, 'αν') ?? rest;
      word = rest;
    }
    if (word.endsWith('ανε')) {
      const rest = word.slice(0, -3);
      touched();
      word = replacePrefix(rest, STEP_5B_PREF_AN, 'αν') ?? rest;
    }
  }

  // step_5c
  {
    if (word.endsWith('ιση')) {
      let rest = word.slice(0, -3);
      touched();
      rest = replaceVowel(rest, VOWELS_NO_U, 'ετ') ?? rest;
      word = rest;
    }
    if (word.endsWith('ετε')) {
      const rest = word.slice(0, -4);
      touched();
      word =
        replaceAnywhere(rest, STEP_5C_ANY, 'ετ') ??
        replacePrefix(rest, STEP_5C_PREF, 'ετ') ??
        rest;
    }
  }

  // step_5d
  {
    const hit = ending(word, STEP_5D_END);
    if (hit !== null) {
      const rest = word.slice(0, -hit.length);
      touched();
      if (rest.endsWith('κρε')) word = 'οντ' + rest.slice(-1);
      else if (rest.startsWith('ο') || rest.startsWith('ω')) word = 'ο' + rest.slice(1);
      else word = rest;
    }
  }

  // step_5e
  {
    const hit = ending(word, STEP_5E_END);
    if (hit !== null) {
      const rest = word.slice(0, -hit.length);
      touched();
      word = rest.startsWith('ο') || rest.startsWith('γο') ? rest.slice(0, -1) + 'στο' : rest;
    }
  }

  // step_5f
  {
    let rest: string | null = null;
    if (word === 'γεστε') {
      rest = replacePrefix('γεστ', STEP_5F_PREF_GES, 'γεσ');
      touched();
    }
    if (rest !== null) word = rest;
    if (word.endsWith('εστε')) {
      const r = word.slice(0, -4);
      touched();
      word = replacePrefix(r, STEP_5F_PREF_GEST, 'γεστ') ?? r;
    }
  }

  // step_5g
  {
    let rest: string | null = null;
    const hit = ending(word, STEP_5G_END_1);
    if (hit !== null) {
      rest = word.slice(0, -hit.length);
      touched();
    }
    if (rest !== null) {
      const hit2 = ending(rest, STEP_5G_END_2);
      if (hit2 !== null) {
        const r = rest.slice(0, -hit2.length);
        touched();
        word =
          replacePrefix(r, STEP_5G_PREF_1, 'ικ') ??
          replacePrefix(r, STEP_5G_PREF_2, 'ικ') ??
          r;
      } else {
        word = rest;
      }
    }
  }

  // step_5h
  {
    const hit = ending(word, STEP_5H_END);
    if (hit !== null) {
      const rest = word.slice(0, -hit.length);
      touched();
      word =
        replacePrefix(rest, STEP_5H_PREF_1, 'ουσ') ??
        replacePrefix(rest, STEP_5H_PREF_2, 'ουσ') ??
        rest;
    }
  }

  // step_5i
  {
    const hit = ending(word, STEP_5I_END);
    if (hit !== null) {
      const rest = word.slice(0, -hit.length);
      touched();
      if (rest.endsWith('κολλ')) {
        word = 'αγ' + rest.slice(4);
      } else {
        word =
          replaceAnywhere(rest, STEP_5I_ANY_1, '') ??
          replaceAnywhere(rest, STEP_5I_ANY_2, 'αγ') ??
          replacePrefix(rest, STEP_5I_PREF, 'αγ') ??
          rest;
      }
    }
  }

  // step_5j
  {
    const hit = ending(word, STEP_5J_END);
    if (hit !== null) {
      const rest = word.slice(0, -hit.length);
      touched();
      word = replacePrefix(rest, STEP_5J_PREF, 'ισ') ?? rest;
    }
  }

  // step_5k
  {
    if (word.endsWith('ιστε')) {
      const rest = word.slice(0, -4);
      touched();
      word = replacePrefix(rest, STEP_5K_PREF, 'ιστ') ?? rest;
    }
  }

  // step_5l
  {
    const hit = ending(word, STEP_5L_END);
    if (hit !== null) {
      const rest = word.slice(0, -hit.length);
      touched();
      word = replacePrefix(rest, STEP_5L_PREF, 'ουν') ?? rest;
    }
  }

  // step_5m
  {
    const hit = ending(word, STEP_5M_END);
    if (hit !== null) {
      const rest = word.slice(0, -hit.length);
      touched();
      word = replacePrefix(rest, STEP_5M_PREF, 'ουμ') ?? rest;
    }
  }

  // step_6 — only when no earlier step changed the word
  if (test1) {
    const mat = ending(word, STEP_6_MAT);
    const subject = mat !== null ? word.slice(0, -mat.length) + 'μ' + word.slice(-1) : word;
    const hit = ending(subject, STEP_6_END);
    if (hit !== null) word = word.slice(0, -hit.length);
  }

  // step_7
  {
    const hit = ending(word, STEP_7_END);
    if (hit !== null) word = word.slice(0, -hit.length);
  }

  /*
   * Adaptation 1: the nominative singular in -ος.
   *
   * The algorithm handles the second-declension noun well once the accents are gone:
   * θεοῦ, θεῷ, θεοί and θεῶν all reduce to θε. It has no rule for the nominative, so
   * λόγος, θεός, ἄνθρωπος and χριστός keep their -οσ while every other case of the
   * same word loses it. That is the worst possible place for a gap, because the
   * nominative is what a reader searches for — someone looking up θεός would not
   * find θεοῦ, which is the other half of the occurrences.
   *
   * An addition, and marked as one.
   */
  if (word.length >= 4 && word.endsWith('οσ')) {
    word = word.slice(0, -2);
  }

  /*
   * Adaptation 2: never return an empty stem.
   *
   * Step 6 contains '{m}{ou}', so μου — "my", "me", and everywhere in a scripture
   * corpus — reduces to the empty string. An empty lexeme in a tsvector matches
   * nothing usefully. The canonical algorithm is right that the Modern Greek clitic
   * is a particle; a search index cannot afford to delete a word, so the unstemmed
   * form is returned.
   */
  if (word.length < 2) {
    if (STEM_CACHE.size >= STEM_CACHE_LIMIT) STEM_CACHE.clear();
    STEM_CACHE.set(folded, folded);
    return foldGreek(input);
  }

  if (STEM_CACHE.size >= STEM_CACHE_LIMIT) STEM_CACHE.clear();
  STEM_CACHE.set(folded, word);
  return word;
}

/**
 * Replaces each Greek token with its stem, leaving other scripts untouched.
 *
 * Used by the measurement, not by the index — see scripts/measure-original-recall.ts
 * for why the two must be kept apart.
 */
export function stemGreekTokens(text: string): string {
  if (!/\p{Script=Greek}/u.test(text)) return text;
  return text
    .split(/([^\p{L}\p{M}]+)/u)
    .map((part) => (/^[\p{L}\p{M}]+$/u.test(part) ? stemGreek(part) : part))
    .join('');
}
