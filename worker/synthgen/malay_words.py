"""Compact stoplist of common Malay function words and high-frequency verbs/adjectives.

Used by the register-compliance validator to filter false positives in the
"English loanword" check. NOT a full Malay dictionary — just the high-volume
words that the naive ASCII heuristic would otherwise flag.
"""
from __future__ import annotations


# Function words, pronouns, common verbs, common adjectives, common nouns.
# Lowercase, no duplicates. Add freely as false positives are observed.
MALAY_COMMON_WORDS: frozenset[str] = frozenset(
    {
        # pronouns
        "saya", "anda", "kamu", "awak", "kita", "kami", "mereka", "dia", "ia",
        # function words
        "dan", "atau", "tetapi", "namun", "kerana", "sebab", "supaya", "agar",
        "untuk", "kepada", "daripada", "dari", "pada", "dalam", "atas", "bawah",
        "antara", "tanpa", "dengan", "oleh", "tentang", "mengenai",
        "ini", "itu", "sini", "situ", "begitu", "begini", "demikian",
        "yang", "adalah", "ialah", "merupakan", "akan", "sudah", "telah",
        "sedang", "masih", "belum", "sangat", "amat", "terlalu", "lebih",
        "kurang", "paling", "agak", "cukup", "hanya", "sahaja", "saja",
        "juga", "pun", "lagi", "pula", "kembali", "semula",
        # common verbs / verbal forms
        "ada", "tiada", "ialah", "membuat", "buat", "membantu", "bantu",
        "menggunakan", "guna", "memberi", "beri", "menerima", "terima",
        "menyemak", "semak", "menghantar", "hantar", "menjawab", "jawab",
        "memohon", "mohon", "mendapat", "dapat", "berikan", "lakukan",
        "menjadi", "jadi", "datang", "pergi", "pulang", "masuk", "keluar",
        "naik", "turun", "buka", "tutup", "log", "selesai", "siap",
        # greetings / common politeness
        "selamat", "sejahtera", "terima", "kasih", "sila", "silakan",
        "tolong", "harap", "mohon",
        # common nouns
        "pelanggan", "akaun", "perkhidmatan", "perkara", "masalah", "soalan",
        "jawapan", "maklumat", "butiran", "permohonan", "pertanyaan",
        "pasukan", "syarikat", "pejabat", "kawasan",
        "hari", "tarikh", "waktu", "masa", "minggu", "bulan", "tahun",
        # negation / modal
        "tidak", "bukan", "mustahil", "boleh", "mungkin", "harus", "perlu",
        "mesti", "wajib",
        # interrogatives
        "apa", "siapa", "mana", "bila", "bagaimana", "mengapa", "kenapa",
        "berapa", "manakah", "sekiranya", "jika", "andai",
        # conjunctions / adverbs
        "iaitu", "yakni", "umpamanya", "antaranya", "termasuk",
    }
)


def is_likely_malay(token: str) -> bool:
    return token.lower() in MALAY_COMMON_WORDS
