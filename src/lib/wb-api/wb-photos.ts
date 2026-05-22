/**
 * Утилита для генерации ссылки на фото товара Wildberries по его nmId.
 * Алгоритм обновлен для работы с wbbasket.ru и форматом .webp
 */
export type WbPhotoSize = 'big' | 'c516x688' | 'c246x328' | 'tm';

export function getWbPhotoUrl(nmId: number, size: WbPhotoSize = 'big'): string {
  const vol = Math.floor(nmId / 100000);
  const part = Math.floor(nmId / 1000);

  let basket = '01';

  if (vol <= 143) basket = '01';
  else if (vol <= 287) basket = '02';
  else if (vol <= 431) basket = '03';
  else if (vol <= 719) basket = '04';
  else if (vol <= 1007) basket = '05';
  else if (vol <= 1061) basket = '06';
  else if (vol <= 1115) basket = '07';
  else if (vol <= 1169) basket = '08';
  else if (vol <= 1313) basket = '09';
  else if (vol <= 1601) basket = '10';
  else if (vol <= 1655) basket = '11';
  else if (vol <= 1919) basket = '12';
  else if (vol <= 2045) basket = '13';
  else if (vol <= 2189) basket = '14';
  else if (vol <= 2405) basket = '15';
  else if (vol <= 2621) basket = '16';
  else if (vol <= 2837) basket = '17';
  else if (vol <= 3053) basket = '18';
  else if (vol <= 3269) basket = '19';
  else if (vol <= 3485) basket = '20';
  else if (vol <= 3701) basket = '21';
  else if (vol <= 3917) basket = '22';
  else if (vol <= 4133) basket = '23';
  else if (vol <= 4349) basket = '24';
  else if (vol <= 4565) basket = '25';
  else if (vol <= 4781) basket = '26';
  else if (vol <= 4997) basket = '27';
  else if (vol <= 5213) basket = '28';
  else if (vol <= 5429) basket = '29';
  else if (vol <= 5645) basket = '30';
  else if (vol <= 5861) basket = '31';
  else basket = '32';

  // Для некорректных ID возвращаем пустую строку
  if (!nmId || nmId === 0) return '';

  // Используем wbbasket.ru и формат .webp для новых товаров.
  // `big` остается дефолтом для обратной совместимости; thumbnail-экраны
  // явно просят `tm`, чтобы не тянуть полноразмерные карточки в таблицы.
  return `https://basket-${basket}.wbbasket.ru/vol${vol}/part${part}/${nmId}/images/${size}/1.webp`;
}

export function getWbThumbnailUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/images\/(big|c516x688|c246x328)\//, '/images/tm/');
}
