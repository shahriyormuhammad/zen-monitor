const postgres = require('postgres');
require('dotenv').config();

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

async function run() {
  const sql = postgres(process.env.DATABASE_URL);
  
  try {
    console.log('Проверка tenant baseline...');
    await sql`
      INSERT INTO tenants (id, name, wb_api_token)
      VALUES (${TENANT_ID}, 'Demo cabinet', 'demo-token')
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          wb_api_token = EXCLUDED.wb_api_token
    `;

    console.log('Очистка старых данных (если есть)...');
    await sql`DELETE FROM raw_api_realization_reports WHERE tenant_id = ${TENANT_ID}`;
    await sql`DELETE FROM raw_api_orders WHERE tenant_id = ${TENANT_ID}`;
    await sql`DELETE FROM unit_economics_configs WHERE tenant_id = ${TENANT_ID}`;
    await sql`DELETE FROM products WHERE tenant_id = ${TENANT_ID}`;
    await sql`DELETE FROM raw_api_ad_costs WHERE tenant_id = ${TENANT_ID}`;
    await sql`DELETE FROM raw_api_funnel_stats WHERE tenant_id = ${TENANT_ID}`;

    console.log('Создание товаров...');
    await sql`
      INSERT INTO products (tenant_id, nm_id, vendor_code, brand, photo_url)
      VALUES 
        (${TENANT_ID}, 123456, 'AIR-PRO-WHITE', 'AudioTech', 'https://images.unsplash.com/photo-1606220588913-b3eea4141216?w=200&q=80'),
        (${TENANT_ID}, 789012, 'CASE-SILICONE-RED', 'CoverMax', 'https://images.unsplash.com/photo-1541818816-56fc60447fa4?w=200&q=80')
    `;

    console.log('Создание себестоимости...');
    await sql`
      INSERT INTO unit_economics_configs (tenant_id, nm_id, cost_price)
      VALUES 
        (${TENANT_ID}, 123456, 1200),
        (${TENANT_ID}, 789012, 120)
    `;

    console.log('Генерация продаж, рекламы и воронки за последние 30 дней...');
    const now = new Date();
    
    for (let i = 0; i <= 30; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        
        let qty1 = Math.floor(Math.random() * 8) + 2;
        let qty2 = Math.floor(Math.random() * 15) + 5;

        // Заказы
        await sql`
            INSERT INTO raw_api_orders (srid, tenant_id, nm_id, date, total_price, is_cancel)
            VALUES 
            (${'srid-1-'+i}, ${TENANT_ID}, 123456, ${d}, ${qty1 * 4000}, false),
            (${'srid-2-'+i}, ${TENANT_ID}, 789012, ${d}, ${qty2 * 500}, false)
        `;

        // Фин. отчеты
        await sql`
            INSERT INTO raw_api_realization_reports (
                rrd_id, tenant_id, realizationreport_id, date_from, date_to, nm_id, quantity, 
                retail_amount, commission_amount, delivery_rub, storage_fee_rub, penalty_rub, spp_rub
            )
            VALUES
            (${1000 + i}, ${TENANT_ID}, 999, ${d}, ${d}, 123456, ${qty1}, ${qty1 * 4000}, ${qty1 * 4000 * 0.15}, ${qty1 * 80}, 100, 0, 0),
            (${2000 + i}, ${TENANT_ID}, 999, ${d}, ${d}, 789012, ${qty2}, ${qty2 * 500}, ${qty2 * 500 * 0.15}, ${qty2 * 45}, 50, 0, 0)
        `;

        // Реклама (слив на первом товаре)
        await sql`
            INSERT INTO raw_api_ad_costs (tenant_id, nm_id, date, amount, type, placement)
            VALUES 
            (${TENANT_ID}, 123456, ${d}, ${2500}, 'unified', 'overall'),
            (${TENANT_ID}, 789012, ${d}, ${150}, 'unified', 'overall')
        `;

        // Воронка (низкий CR на втором товаре)
        await sql`
            INSERT INTO raw_api_funnel_stats (tenant_id, nm_id, date, open_card_count, add_to_cart_count, order_count, order_sum)
            VALUES 
            (${TENANT_ID}, 123456, ${d}, 500, 80, ${qty1}, ${qty1 * 4000}),
            (${TENANT_ID}, 789012, ${d}, 5000, 50, ${qty2}, ${qty2 * 500})
        `;
    }
    console.log('Моковые данные c РЕКЛАМОЙ и ВОРОНКОЙ сгенерированы!');
  } catch (err) {
    console.error('Ошибка:', err);
  } finally {
    await sql.end();
  }
}

run();
