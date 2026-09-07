#!/bin/bash
# Ende-til-ende: starter server, kjører gjennom kundeflyten, stopper server.
cd /home/claude/korthaien-kjop
rm -f korthaien-kjop.db
npx tsx src/cli.ts seed > /dev/null 2>&1
ADMIN_PASSWORD=test123 SESSION_SECRET=abc PORT=3111 npx tsx src/server.ts > /tmp/srv.log 2>&1 &
SRV=$!
trap "kill $SRV 2>/dev/null" EXIT
for i in $(seq 1 30); do curl -sf localhost:3111/api/health > /dev/null && break; sleep 0.5; done

echo "=== 1. BULK: tvetydige kort ==="
curl -s -X POST localhost:3111/api/bulk -H 'Content-Type: application/json' \
  -d '{"tekst":"4 Lightning Bolt\n2 Ragavan, Nimble Pilferer (MH2) 138\n1 Void [INV]\n1 Black Lotus"}' \
| python3 -c "
import json,sys
d=json.load(sys.stdin)
for r in d['resultat']:
    print(f\"  linje {r['linje']}: {r['navn'][:26]:28} x{r['qty']}  [{r['status']}] {r.get('melding') or ''}\")
    for v in r['valg'][:4]:
        print(f\"        -> {v['set_name'][:26]:28} #{str(v['collector_number']):5} ledig={v['available']}\")
"

echo
echo "=== 2. ORDRE: kunde sender inn 6 Invasion-bolt (kvoten er 6) ==="
curl -s -X POST localhost:3111/api/orders -H 'Content-Type: application/json' \
  -d '{"customer_name":"Ola Nordmann","email":"ola@example.com","linjer":[
        {"card_id":"seed-inv-bolt","finish":"nonfoil","condition":"NM","qty":6},
        {"card_id":"seed-mh2-raga","finish":"nonfoil","condition":"NM","qty":2},
        {"card_id":"seed-leb-ance","finish":"nonfoil","condition":"EX","qty":1}]}' \
| python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  Ordrenr:', d['order_no'], '  Total:', d['total_nok'], 'kr')
print('  Linjer sortert på sett, deretter navn:')
for l in d['linjer']:
    print(f\"    {l['set_name'][:24]:26} {l['card_name'][:26]:28} {l['condition']:3} x{l['qty']}  {l['unit_nok']} kr\")
print('  Instruksjon 1:', d['instruksjoner'][0][:70])
"

echo
echo "=== 3. KVOTE: neste kunde prøver samme kort ==="
curl -s -X POST localhost:3111/api/orders -H 'Content-Type: application/json' \
  -d '{"customer_name":"Kari Nordmann","email":"kari@example.com","linjer":[
        {"card_id":"seed-inv-bolt","finish":"nonfoil","condition":"NM","qty":3}]}' \
| python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  Svar:', d.get('feil'))
for a in d.get('avvist',[]): print('   ', a['grunn'])
"

echo
echo "=== 4. VALIDERING: condition settet ikke tar imot ==="
curl -s -X POST localhost:3111/api/orders -H 'Content-Type: application/json' \
  -d '{"customer_name":"Per Hansen","email":"per@example.com","linjer":[
        {"card_id":"seed-leb-ance","finish":"nonfoil","condition":"G","qty":1}]}' \
| python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  Svar:', d.get('feil'))
for a in d.get('avvist',[]): print('   ', a['grunn'])
"

echo
echo "=== 5. ADMIN: dashbord og mottak ==="
curl -s -c /tmp/kh.jar -X POST localhost:3111/api/admin/login -H 'Content-Type: application/json' -d '{"password":"test123"}' > /dev/null
echo -n "  Uten innlogging: "; curl -s localhost:3111/api/admin/orders | head -c 60; echo
curl -s -b /tmp/kh.jar localhost:3111/api/admin/orders | python3 -c "
import json,sys
d=json.load(sys.stdin)
for o in d:
    print(f\"  {o['order_no']}  {o['customer_name']:14} {o['status']:8} {o['total_nok']} kr  ({len(o['linjer'])} linjer)\")
    globals()['oid']=o['id']
import os
open('/tmp/oid','w').write(str(globals().get('oid','')))
"
OID=$(cat /tmp/oid)
curl -s -b /tmp/kh.jar -X PATCH localhost:3111/api/admin/orders/$OID -H 'Content-Type: application/json' -d '{"status":"received"}' > /dev/null
echo -n "  Etter merking som mottatt — aktive: "
curl -s -b /tmp/kh.jar localhost:3111/api/admin/orders | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"
echo -n "  I arkivet: "
curl -s -b /tmp/kh.jar "localhost:3111/api/admin/orders?arkiv=1" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"

echo
echo "=== 6. KVOTE HOLDES til varene er lagerfort ==="
echo -n "  Etter mottak (skal vaere 0, kortene er ikke i Mystore enda): "
curl -s "localhost:3111/api/search?q=lightning" | python3 -c "
import json,sys
xs=[t for t in json.load(sys.stdin) if t['set_code']=='inv']
print(xs[0]['available'] if xs else 'ikke tilbudt')
"
curl -s -b /tmp/kh.jar -X PATCH localhost:3111/api/admin/orders/$OID -H 'Content-Type: application/json' -d '{"status":"stocked"}' > /dev/null
echo -n "  Etter lagerforing, uten at Mystore-synk har kjort: "
curl -s "localhost:3111/api/search?q=lightning" | python3 -c "
import json,sys
xs=[t for t in json.load(sys.stdin) if t['set_code']=='inv']
print((str(xs[0]['available'])+' (synken vil sette beholdningen til 8)') if xs else 'ikke tilbudt')
"
echo -n "  I arkivet na: "
curl -s -b /tmp/kh.jar "localhost:3111/api/admin/orders?arkiv=1" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"
