import {
  Horizon,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
} from '@stellar/stellar-sdk';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);
export const NETWORK_PASSPHRASE = Networks.TESTNET;

export const USDC_ASSET = new Asset(
  'USDC',
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
);

export async function fetchAccount(publicKey) {
  return server.loadAccount(publicKey);
}

export async function fetchBalances(publicKey) {
  const account = await server.loadAccount(publicKey);
  const balances = {};
  for (const b of account.balances) {
    if (b.asset_type === 'native') {
      balances.XLM = parseFloat(b.balance);
    } else if (b.asset_code === 'USDC' && b.asset_issuer === USDC_ASSET.getIssuer()) {
      balances.USDC = parseFloat(b.balance);
    }
  }
  return balances;
}

// Build a setOptions tx to add a session signer (returns XDR for wallet signing)
export async function buildAddSignerTx(ownerPublicKey, sessionPublicKey) {
  const account = await server.loadAccount(ownerPublicKey);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.setOptions({
        signer: { ed25519PublicKey: sessionPublicKey, weight: 1 },
      })
    )
    .setTimeout(60)
    .build();
  return tx.toXDR();
}

// Build a setOptions tx to remove a session signer (returns XDR for wallet signing)
export async function buildRemoveSignerTx(ownerPublicKey, sessionPublicKey) {
  const account = await server.loadAccount(ownerPublicKey);
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.setOptions({
        signer: { ed25519PublicKey: sessionPublicKey, weight: 0 },
      })
    )
    .setTimeout(60)
    .build();
  return tx.toXDR();
}

// Submit a signed XDR string — extracts Horizon error codes from 400 responses
export async function submitTx(signedXdr) {
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  try {
    return await server.submitTransaction(tx);
  } catch (err) {
    // Extract Stellar-specific error from Horizon 400 response
    const resultCodes = err?.response?.data?.extras?.result_codes;
    if (resultCodes) {
      const txCode  = resultCodes.transaction || '';
      const opCodes = resultCodes.operations  || [];
      const detail  = [txCode, ...opCodes].filter(Boolean).join(', ');
      const enhanced = new Error(`Transaction failed: ${detail}`);
      enhanced.stellarResultCodes = resultCodes;
      enhanced.originalError = err;
      throw enhanced;
    }
    throw err;
  }
}

// Build an unsigned payment tx and return XDR — for manual wallet signing
export async function buildPaymentTxXdr(sourcePublicKey, destination, amount, assetCode) {
  const account = await server.loadAccount(sourcePublicKey);
  const asset = assetCode === 'XLM' ? Asset.native() : USDC_ASSET;

  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset,
        amount: String(amount),
      })
    )
    .setTimeout(60)
    .build();

  return tx.toXDR();
}

// Send a payment signed by the session keypair (auto-pay)
export async function sendPayment(sessionKeypair, sourcePublicKey, destination, amount, assetCode) {
  const account = await server.loadAccount(sourcePublicKey);
  const asset = assetCode === 'XLM' ? Asset.native() : USDC_ASSET;

  const transaction = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset,
        amount: String(amount),
      })
    )
    .setTimeout(60)
    .build();

  transaction.sign(sessionKeypair);
  const result = await server.submitTransaction(transaction);

  // Explicit guard: should never be false for a 200 response, but catch it defensively
  if (!result.successful) {
    throw new Error(`Transaction included but marked unsuccessful (hash: ${result.hash})`);
  }

  console.log(`💸 Auto-pay successful | hash: ${result.hash} | amount: ${amount} ${assetCode}`);
  return result;
}

export function classifyError(err) {
  const msg = err?.message || String(err);
  const extras = err?.response?.data?.extras;

  if (msg.includes('tx_bad_seq') || extras?.result_codes?.transaction === 'tx_bad_seq') {
    return { code: 'tx_bad_seq', message: 'Transaction sequence number mismatch. Retrying...' };
  }
  if (
    msg.includes('op_underfunded') ||
    extras?.result_codes?.operations?.includes('op_underfunded')
  ) {
    return { code: 'op_underfunded', message: 'Insufficient balance for this payment.' };
  }
  if (msg.includes('timeout') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
    return { code: 'network_timeout', message: 'Network timeout. Will retry next cycle.' };
  }
  return { code: 'unknown', message: msg };
}
