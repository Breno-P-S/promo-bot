import { describe, expect, it } from "vitest";
import { classificarCategorias } from "../../src/processor/classificar-categorias";

function categoria(overrides: Record<string, unknown>) {
  return {
    id: String(overrides.id ?? overrides.chave),
    chave: String(overrides.chave),
    nome: String(overrides.nome),
    descricao: null,
    ativo: true,
    prioridade: Number(overrides.prioridade ?? 0),
    limiarConfianca: Number(overrides.limiarConfianca ?? 55),
    palavrasChave: overrides.palavrasChave ?? [],
    palavrasExclusao: overrides.palavrasExclusao ?? [],
    criadoEm: new Date(),
    atualizadoEm: new Date(),
  } as any;
}

const categorias = [
  categoria({ chave: "tecnologia", nome: "Tecnologia", prioridade: 100, palavrasChave: ["notebook", "smartphone", "tablet"] }),
  categoria({ chave: "moda", nome: "Moda", prioridade: 50, palavrasChave: ["camiseta", "shorts", "tênis"] }),
  categoria({ chave: "pais", nome: "Pais", prioridade: 70, palavrasChave: ["furadeira", "parafusadeira", "kit churrasco"] }),
  categoria({ chave: "maes", nome: "Mães", prioridade: 70, palavrasChave: ["air fryer", "escova secadora"] }),
  categoria({ chave: "casa", nome: "Casa", prioridade: 60, palavrasChave: ["air fryer", "panela", "aspirador"] }),
];

describe("classificarCategorias", () => {
  it("classifica um produto tecnológico com confiança alta", () => {
    const r = classificarCategorias(categorias, {
      produto: "Notebook Lenovo IdeaPad Ryzen 7 16GB",
      textoOriginal: "Notebook Lenovo em promoção",
    });
    expect(r.principal?.chave).toBe("tecnologia");
    expect(r.confiancaPrincipal).toBeGreaterThanOrEqual(70);
  });

  it("permite múltiplas categorias quando há evidência", () => {
    const r = classificarCategorias(categorias, {
      produto: "Air Fryer Mondial 5L",
      textoOriginal: "Air Fryer Mondial 5L por R$ 399",
    });
    expect(r.classificacoes.map((c) => c.chave)).toContain("maes");
    expect(r.classificacoes.map((c) => c.chave)).toContain("casa");
  });

  it("não força categoria sem evidência", () => {
    const r = classificarCategorias(categorias, {
      produto: "Produto Genérico ABC",
      textoOriginal: "Oferta por R$ 50",
    });
    expect(r.classificacoes).toHaveLength(0);
    expect(r.confiancaPrincipal).toBe(0);
  });
});
