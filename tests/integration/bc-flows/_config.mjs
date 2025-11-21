/**
 * BC Test Data Configuration
 *
 * Verified against Danish CRONUS demo data (Cronus27 container)
 * Last verified: 2025-11-21
 */

export const BC_CONFIG = {
  container: 'Cronus27',
  url: 'http://Cronus27/BC/?tenant=default',
  credentials: {
    username: 'sshadows',
    password: '1234',
  },
};

export const TEST_DATA = {
  // Customer 10000
  customer: {
    no: '10000',
    name: 'Kontorcentralen A/S',
    address: '192 Market Square',
    city: 'Nyborg',
    postCode: '5800',
    email: 'robert.townes@contoso.com',
    contact: 'Robert Townes',
    genBusPostingGroup: 'INDENLANDSK',
    customerPostingGroup: 'INDENLANDSK',
  },

  // Item 1896-S
  item: {
    no: '1896-S',
    description: 'ATHEN Skrivebord',
    unitPrice: 5560.00,
    baseUnitOfMeasure: 'STK',
    genProdPostingGroup: 'DETAIL',
    inventoryPostingGroup: 'VIDERESALG',
  },

  // Sales Order 101001
  salesOrder: {
    no: '101001',
    sellToCustomerNo: '10000',
    sellToCustomerName: 'Kontorcentralen A/S',
    status: 'Open',
  },
};

export const PAGES = {
  customerCard: '21',
  customerList: '22',
  itemCard: '30',
  itemList: '31',
  salesOrderCard: '42',
  salesOrderList: '9305',
};

// Test prefixes for created records
export const TEST_PREFIX = 'TEST-MCP-';
