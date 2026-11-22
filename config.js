// פרויקט Supabase: hatmada
// המפתח הזה נועד להיות גלוי בדפדפן. הטבלאות סגורות בפניו,
// והגישה היחידה אליהן היא דרך שלוש הפונקציות שב-schema.sql.

// המפתח הציבורי של VAPID נועד גם הוא להיות גלוי — הדפדפן שולח אותו
// לשירות ההתראות בכל הרשמה. המפתח הפרטי שלו לא נכנס למאגר בשום צורה:
// הוא סוד ב-Supabase. ההוראות ב-PUSH-SETUP.md.
// כל עוד השורה ריקה, כפתור התזכורת פשוט לא מופיע.

window.CONFIG = {
  SUPABASE_URL: "https://kzwmerqvzxfbkpslriud.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_4V5e3TlLzrWet8JI5OepCg_w4zAbS61",
  VAPID_PUBLIC_KEY: "",

  // קישורים שהלקוח רואה בתוך המשימות. ריק = הקישור פשוט לא מוצג.
  LINKS: {
    video1: "https://youtu.be/qth77HmSi10",
    // המצגת מוגשת מהאתר עצמו ולא כארטיפקט של קלוד: ארטיפקט פרטי נפתח
    // רק לבעלים, והלקוח מקבל דף שבור בלי שאף אחד יידע.
    deck1:  "deck.html?f=habit-loop-deck.pdf"
  }
};
