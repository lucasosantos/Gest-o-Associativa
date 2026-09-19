// Hash da senha de acesso de uma associação (ver `config.rs`). Usa
// PBKDF2-HMAC-SHA256 implementado com as crates `hmac`+`sha2` (já
// resolvidas no projeto — `sha2` desde a Etapa 7, para checksum de
// documento) em vez de uma crate de hashing de senha pronta (`argon2`,
// por exemplo): essa não estava no `Cargo.lock` e arriscaria depender de
// acesso à rede para compilar. PBKDF2 com salt aleatório e um número alto
// de iterações é seguro o bastante para proteger um arquivo de
// configuração local — não é um serviço de login exposto à internet.
//
// Formato guardado em `config.json`: `pbkdf2$<iterações>$<salt-hex>$<hash-hex>`.

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

const ITERATIONS: u32 = 100_000;
const SALT_LEN: usize = 16;
const HASH_LEN: usize = 32;

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

/// PBKDF2-HMAC-SHA256 (RFC 8018), implementado à mão a partir de
/// `hmac`+`sha2` — não há crate `pbkdf2` no `Cargo.lock` deste projeto.
fn pbkdf2_hmac_sha256(password: &[u8], salt: &[u8], iterations: u32, output_len: usize) -> Vec<u8> {
    let mut output = Vec::with_capacity(output_len);
    let mut block_index: u32 = 1;

    while output.len() < output_len {
        let mut mac = HmacSha256::new_from_slice(password).expect("chave HMAC de tamanho arbitrário");
        mac.update(salt);
        mac.update(&block_index.to_be_bytes());
        let mut u = mac.finalize().into_bytes();
        let mut block = u.to_vec();

        for _ in 1..iterations {
            let mut mac = HmacSha256::new_from_slice(password).expect("chave HMAC de tamanho arbitrário");
            mac.update(&u);
            u = mac.finalize().into_bytes();
            for (b, x) in block.iter_mut().zip(u.iter()) {
                *b ^= x;
            }
        }

        output.extend_from_slice(&block);
        block_index += 1;
    }

    output.truncate(output_len);
    output
}

/// Gera o hash guardado em `config.json` para uma senha nova.
pub fn hash_password(password: &str) -> String {
    let mut salt = [0u8; SALT_LEN];
    getrandom::getrandom(&mut salt).expect("falha ao gerar salt aleatório");

    let hash = pbkdf2_hmac_sha256(password.as_bytes(), &salt, ITERATIONS, HASH_LEN);
    format!("pbkdf2${}${}${}", ITERATIONS, to_hex(&salt), to_hex(&hash))
}

/// Confere uma senha contra o hash guardado. Formato inesperado (config.json
/// editado à mão, por exemplo) é tratado como senha incorreta, nunca como
/// erro que trava o app.
pub fn verify_password(password: &str, stored: &str) -> bool {
    let partes: Vec<&str> = stored.split('$').collect();
    let [algoritmo, iteracoes, salt_hex, hash_hex] = match partes.as_slice() {
        [a, b, c, d] => [*a, *b, *c, *d],
        _ => return false,
    };

    if algoritmo != "pbkdf2" {
        return false;
    }

    let iterations: u32 = match iteracoes.parse() {
        Ok(n) => n,
        Err(_) => return false,
    };

    let salt = match from_hex(salt_hex) {
        Some(s) => s,
        None => return false,
    };

    let hash_esperado = match from_hex(hash_hex) {
        Some(h) => h,
        None => return false,
    };

    let hash_calculado = pbkdf2_hmac_sha256(password.as_bytes(), &salt, iterations, hash_esperado.len());
    hash_calculado == hash_esperado
}
