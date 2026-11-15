# ריבקין ירקות – אתר הזמנות

אתר הזמנות לירקות ופירות של **ריבקין ירקות**, כפר חב״ד.

- כתובת: https://rivkinyerakot.net
- אחסון: Netlify (פריסה אוטומטית מ-git)
- דומיין: Namecheap
- ההזמנות נשלחות ל-Google Sheets דרך Google Apps Script

## מבנה התיקייה

```
index.html        דף ההזמנות הראשי
terms.html        תקנון, מדיניות פרטיות והצהרת נגישות
404.html          דף "לא נמצא" (Netlify מציג אותו אוטומטית)
css/style.css     עיצוב
js/script.js      לוגיקה: קטלוג, סל, שליחת הזמנה
assets/images/    לוגו, לוח שעות, כשרות, תמונת שיתוף (og-image)
assets/icons/     אייקונים
_headers          כותרות אבטחה של Netlify
robots.txt, sitemap.xml, favicon.png, googlef…html   חייבים להישאר בתיקייה הראשית
```

## עדכונים נפוצים

- **שעות פעילות:** לעדכן את כרטיס השעות ב-`index.html`, את `openingHoursSpecification` באותו קובץ, את הלוגיקה ב-`js/script.js`, ואת התמונה `assets/images/hours.webp` (רוחב 800px, WebP).
- **תמונות חדשות:** רוחב של עד 800px, בפורמט WebP. שמות באנגלית בלבד, בלי רווחים.
