// Tipos usados pela integração com o programa de afiliados do Mercado
// Livre. Mantidos separados para reuso entre resolver, afiliados,
// cache e testes.

// Forma mínima do componente "card-featured" encontrado no HTML da
// página /social/... do Mercado Livre. Só tipamos os campos que
// realmente usamos — o resto do objeto real é bem mais complexo.
export interface ComponentePolycardMetadata {
  id?: string;
  product_id?: string;
  url?: string;
}

export interface ComponentePolycard {
  metadata?: ComponentePolycardMetadata;
}

export interface ComponenteCardFeatured {
  id: string;
  recommendation_data?: {
    recommendation_info?: {
      polycards?: ComponentePolycard[];
    };
  };
}

// Resposta real do endpoint createLink do Link Builder do Mercado Livre.
export interface RespostaCreateLinkItem {
  id?: string;
  created?: boolean;
  tag?: string;
  short_url?: string;
  long_url?: string;
  origin_url?: string;
  type_url?: string;
  error?: string;
}

export interface RespostaCreateLink {
  status?: number;
  urls?: RespostaCreateLinkItem[];
  total_items?: number;
  total_success?: number;
  total_error?: number;
}

// Resultado da resolução de um link curto meli.la — guardamos o
// productId separadamente da URL canônica porque o cache indexa por ele.
export interface ProdutoResolvido {
  productId: string | null;
  urlCanonica: string;
}
