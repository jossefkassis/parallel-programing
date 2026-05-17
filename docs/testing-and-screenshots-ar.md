# دليل الاختبارات ولقطات الشاشة

## 1. التحضير قبل أي اختبار

1. تشغيل الخدمات:

```bash
docker compose -f docker-compose.local.yml up -d postgres redis prometheus grafana nginx
pnpm db:migrate
pnpm db:seed
pnpm start:dev
```

2. فتح لوحة العرض:

```text
http://localhost:3000/dashboard
```

3. قبل كل تجربة اضغط زر **Reset demo data** حتى تبدأ من حالة نظيفة.

---

## 2. اللقطات المطلوبة داخل لوحة العرض

### أ. حماية البيانات من التضارب

اضغط:

```text
Compare unsafe vs safe
```

التقط صورة تظهر:
- نتيجة النسخة غير الصحيحة
- نتيجة النسخة الصحيحة
- الفرق في `finalStock`
- عبارة النجاح التي تثبت منع lost updates

### ب. إدارة الموارد

اضغط:

```text
Compare uncontrolled vs controlled
```

التقط صورة تظهر:
- `peakActive` قبل التحكم وبعده
- أن النسخة المضبوطة تقلل الضغط على الموارد

### ج. المعالجة غير المتزامنة

اضغط:

```text
Compare sync vs async
```

التقط صورة تظهر:
- زمن استجابة النسخة المتزامنة
- زمن استجابة النسخة غير المتزامنة
- الفرق الرقمي بينهما

### د. المعالجة على دفعات

اضغط:

```text
Compare all-at-once vs chunked
Queue real background job
```

التقط صورتين:
- مقارنة الذاكرة بين all-at-once و chunked
- لوحة قاعدة البيانات بعد تشغيل background job بحيث يظهر سجل في `dailySalesSummaries`

### هـ. اختبار الضغط 100 و200 مستخدم

اضغط:

```text
Run 100 users
Run 200 users
```

التقط صورة لكل اختبار تظهر:
- عدد المستخدمين
- عدد الطلبات الناجحة والفاشلة
- حالة المخزون قبل وبعد
- عدد الطلبات قبل وبعد
- عبارة `PASS`

### و. قاعدة البيانات

التقط صورة من قسم:

```text
Database evidence
```

ويفضل أن تظهر فيها:
- `tableCounts`
- `product`
- `recentOrders`
- `recentJobs`
- `dailySalesSummaries`

---

## 3. اختبارات k6 المطلوبة للتقرير

شغّل هذه الأوامر من مجلد المشروع:

```bash
k6 run tests/k6/race-unsafe.js
k6 run tests/k6/race-safe.js
k6 run tests/k6/resource-uncontrolled.js
k6 run tests/k6/resource-controlled.js
k6 run tests/k6/checkout-sync.js
k6 run tests/k6/checkout-webhook.js
k6 run tests/k6/stress-checkout-100.js
k6 run tests/k6/stress-checkout-200.js
k6 run tests/k6/load-balancer.js
```

## 4. ماذا نصوّر من شاشة k6؟

لكل اختبار، التقط صورة يظهر فيها:
- اسم الملف الذي تم تشغيله
- عدد المستخدمين `vus`
- عدد الطلبات المنفذة
- `http_req_duration`
- `http_req_failed`
- زمن التنفيذ الكلي

أهم صورتين للتقرير:
- `stress-checkout-100.js`
- `stress-checkout-200.js`

لأنهما يثبتان قدرة النظام على التعامل مع 100 و200 مستخدم متزامن.

---

## 5. ترتيب الصور المقترح داخل التقرير

1. صورة لوحة المشروع العامة.
2. مقارنة race condition.
3. مقارنة إدارة الموارد.
4. مقارنة sync vs async.
5. مقارنة batch processing.
6. صورة background job وظهوره في قاعدة البيانات.
7. صورة stress test لـ 100 مستخدم من لوحة المشروع.
8. صورة stress test لـ 200 مستخدم من لوحة المشروع.
9. صورة k6 لاختبار 100 مستخدم.
10. صورة k6 لاختبار 200 مستخدم.
11. صورة توزيع الأحمال بين `app1` و `app2`.
12. صورة من Grafana أو `/metrics` إن رغبت بإضافة دليل مراقبة إضافي.

---

## 6. ملاحظات مهمة أثناء التصوير

- استخدم دائمًا **Reset demo data** قبل المقارنات حتى تكون النتائج واضحة.
- بعد اختبار 100 أو 200 مستخدم، انتظر بضع ثوانٍ قبل تصوير `recentJobs` لأن مهام الخلفية تكمل بعد رجوع الطلب للمستخدم.
- في اختبار load balancing يجب تشغيل نسختين:

```bash
$env:PORT=3001; $env:INSTANCE_NAME="app1"; pnpm start:dev
$env:PORT=3002; $env:INSTANCE_NAME="app2"; pnpm start:dev
```

- ثم افتح الخدمة عبر Nginx على:

```text
http://localhost:8080/api/demo/load-balancer/ping
```

