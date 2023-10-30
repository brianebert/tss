import {default as _sodium} from 'libsodium-wrappers';

// make sure library loaded
async function libsodium() {
    await _sodium.ready;
    return _sodium // Promise<ISodium>
}

function addNonceToMessage(nonce, ciphertext) {
  let concatenated = new Uint8Array(new ArrayBuffer(nonce.byteLength + ciphertext.byteLength));
  let i = 0;
  for(; i<nonce.byteLength; i++)
    concatenated[i] = nonce[i];
  for(let j = 0; j < ciphertext.byteLength; j++)
    concatenated[i++] = ciphertext[j];

  return concatenated
}

function splitNonceFromMessage(nonceBytes, messageWithNonce) {
  const nonce = messageWithNonce.slice(0, nonceBytes);
  const message = messageWithNonce.slice(nonceBytes, messageWithNonce.length);

  return [nonce, message]
}

async function encrypt(message, key) {
  const sodium = await libsodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(
    message, nonce, key
  );
  return addNonceToMessage(nonce, ciphertext)
}

async function encryptFor(message, recipient, sender){
  const sodium = await libsodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(
    message, nonce, recipient, sender
  );
  return addNonceToMessage(nonce, ciphertext)
}

//   ciphertextWithNonce: Uint8Array
//  senderPublicKey: Uint8Array
//  recipientPrivateKey: Uint8Array
async function decrypt(ciphertextWithNonce, key) {
  const sodium = await libsodium();
  const [nonce, ciphertext] = splitNonceFromMessage(sodium.crypto_box_NONCEBYTES, Buffer.from(ciphertextWithNonce));
  const decrypted = sodium.crypto_secretbox_open_easy(
    ciphertext, nonce, key
  );
  return decrypted
}

async function decryptFrom(ciphertextWithNonce, recipient, sender){
  const sodium = await libsodium();
  const [nonce, ciphertext] = splitNonceFromMessage(sodium.crypto_box_NONCEBYTES, Buffer.from(ciphertextWithNonce));
  const decrypted = sodium.crypto_box_open_easy(
    ciphertext, nonce, sender, recipient
  );
  return decrypted
}

async function keysFromSig(sig, constants){
  const sodium = await libsodium();

  // hash phrases cannot change without breaking user access to records
  const hashes = {box: sodium.crypto_generichash(sodium.crypto_generichash_BYTES, sodium.from_string(sig + 'Asymetric')),
                  sig: sodium.crypto_generichash(sodium.crypto_generichash_BYTES, sodium.from_string(sig + 'Signing')),
                  kx: sodium.crypto_generichash(sodium.crypto_generichash_BYTES, sodium.from_string(sig + 'ShareKX'))};

  const boxKeys = sodium.crypto_box_seed_keypair(hashes.box);
  const sigKeys = sodium.crypto_sign_seed_keypair(hashes.sig);
  const kxKeys = sodium.crypto_kx_seed_keypair(hashes.kx);

  return {ed25519: {pk: sigKeys.publicKey,
                    sk: sigKeys.privateKey},
          ec25519: {pk: boxKeys.publicKey,
                    sk: boxKeys.privateKey},
          shareKX: {pk: kxKeys.publicKey,
                    sk: kxKeys.privateKey}                 
        }
}

async function sharedKeys(keys, pk=null){
  const sodium = await libsodium();
  if(!pk)
    throw new Error('Suspicious public key')

  return {rx: sodium.crypto_kx_server_session_keys(keys.pk, keys.sk, pk).sharedRx,
          tx: sodium.crypto_kx_client_session_keys(keys.pk, keys.sk, pk).sharedTx}
}

export {encrypt, decrypt, encryptFor, decryptFrom, keysFromSig, sharedKeys}